# Stories — Payments

## Phase 1: counter payments (BUSINESS_RULES D1)

Until the online gateway arrives (Phase 2, Razorpay), subscriptions and deposits are paid at the counter and
**recorded** by staff with `payments.recordOffline`:

- `payments-recordOffline` takes the subscription, method (cash, UPI, card, bank transfer), the gateway/UPI
  reference (required except for cash) and the amount, which **must equal** the amount due.
- In **one transaction** it writes `orgs/{o}/payments/{id}` (status SUCCESS, lines: SUBSCRIPTION + DEPOSIT),
  activates the subscription and posts DEPOSIT_COLLECTED to the deposit ledger, with an audit entry.
- **Idempotent:** a retried request (same `requestId`) returns the first result; a second payment for an already
  active subscription is rejected (tested: exactly one payment, one activation).
- Deposit refunds are recorded as outgoing payments (`direction: OUT`, purpose DEPOSIT_REFUND).

Amounts are integers in **paise**; currency INR.

## Online payments with Razorpay (per branch)

**Setup (Branches → Payments, `branches.manage`).** Each branch can use its own Razorpay account:

- Key ID (`rzp_test_…` for testing, `rzp_live_…` for real money), key secret, webhook secret, and whether Razorpay
  sends links by SMS and/or email. *Test connection* checks the key with Razorpay.
- Public settings are on the branch (`branches/{b}.payments.razorpay`: enabled, keyId, mode, notifySms,
  notifyEmail, hasWebhookSecret). **Secrets** are in `orgs/{o}/branches/{b}/private/razorpay`, which Security Rules
  deny to every client; only Cloud Functions read them. Secrets are write-only in the console (blank = keep) and
  never written to the audit log.
- **Webhook:** Razorpay Dashboard → Account & Settings → Webhooks → Add: URL shown in the dialog
  (`https://asia-south1-<project>.cloudfunctions.net/razorpayWebhook?o=<orgId>&b=<branchId>`), the same webhook secret,
  events `payment_link.paid`, `qr_code.credited`, `refund.processed` and `refund.failed`.

**Collecting (member page → pending subscription → *Collect online*, `payments.recordOffline`):**

- **Send payment link** — `payments-createRequest` (channel LINK) creates a Razorpay Payment Link for the exact
  amount due (7 days), and Razorpay sends it to the member's mobile (SMS) and email. The member pays by UPI, card or
  net banking.
- **Show UPI QR code** — channel QR creates a single-use, fixed-amount UPI QR code (closes after 30 minutes) to scan
  at the counter with any UPI app. If the Razorpay account doesn't have QR Codes enabled, a payment link is shown as
  a QR code instead (channel QR_LINK, not sent by SMS/email).
- Requests are stored in `orgs/{o}/paymentRequests/{razorpayId}` (status OPEN → PAID / CANCELLED). A retried
  request (same `requestId`) or an open request for the same subscription is reused, never duplicated.
- The dialog watches the request live. **The browser is never trusted to report success:** the payment is applied
  only from Razorpay's signed webhook (HMAC-SHA256 of the raw body with the branch's webhook secret) or from
  *Check payment status*, which asks Razorpay's API directly (use it when the webhook isn't set up).
- Applying a payment reuses the counter-payment logic in one transaction: payment record (method `ONLINE_LINK` /
  `ONLINE_UPI_QR`, reference = Razorpay payment id, `gateway` ids), subscription activated, deposit collected into
  the ledger, audit entry. It is **idempotent** (a repeated webhook does nothing). Money that can't be applied —
  the subscription was cancelled or already paid, or the amount differs — is recorded with status
  `NEEDS_ATTENTION` for finance to refund or apply by hand; the subscription is not changed.
- *Cancel request* cancels the link / closes the QR code at Razorpay.

## Refunds

**Where:** Operations → Members → **Payments & refunds** (`payments.view`), or *Refund* on a payment in the
member's History tab. The page lists the branch's payments received, the ones that **need attention** (money
Razorpay collected that couldn't be applied), and the refunds made.

**Who:** `payments.refund` at the payment's branch: librarians, branch managers, franchise owners and finance. The
amount is what the person refunding approves, up to what is left on the payment (refunds already made or in
progress count). Nobody else needs to approve it.

**How the money goes back:**

- **Razorpay payments** (links and UPI QR codes) are refunded through Razorpay
  (`POST /payments/{id}/refund`, `payments-refund` with method `RAZORPAY`), to the member's card, UPI or bank
  account, **paid from the branch's Razorpay balance** (keep enough balance there; Razorpay refuses a refund it
  can't cover and the error is shown). Speed: *normal* (5–7 working days, no fee) or *instant* where the bank allows
  (Razorpay charges a fee). Full or partial; several partial refunds may add up to the payment.
- **Counter payments** can't go back through Razorpay: the money is returned at the counter and recorded (cash,
  UPI or bank transfer, with the reference for UPI and bank).

**Records:** each refund is a payment with `direction: OUT`, `purpose: REFUND` and `refundOf` (the payment
refunded), with the reason, who made it and the Razorpay refund id. The original payment keeps `refundedMinor`
(and `refundedDepositMinor`). The part taken **from the deposit** (up to what that payment collected as deposit
and the member's current balance) leaves the deposit ledger as `DEPOSIT_REFUND`; the rest refunds the fee.
Refunding does not cancel the subscription.

**Steps and states (Razorpay):** Razorpay can't be part of a Firestore transaction, so a refund is *reserved*
first (status PROCESSING, counted against the payment), then Razorpay is asked, then it is *settled*:

| Status | Meaning |
| --- | --- |
| PROCESSING | Reserved; Razorpay is being asked. |
| PENDING | Razorpay accepted it; the bank hasn't confirmed yet (shown as "With the bank"). The deposit part is already taken. |
| SUCCESS | Refunded. Counter refunds are SUCCESS straight away. |
| FAILED | Razorpay refused or later failed it; the amount is refundable again and any deposit part is restored (`DEPOSIT_ADJUSTMENT`). |

`refund.processed` / `refund.failed` webhooks move a refund on; *Check status* (`payments-checkRefund`) asks
Razorpay directly, and also finds a refund whose answer was never saved (by its receipt, the refund's id). A retried
request (same `requestId`) returns the first refund and never refunds twice. Every refund is in the audit log.

## Later

Member self-service payments in the member app (Phase 2), and payments for other purposes (fines, damage) through
the same request flow.
