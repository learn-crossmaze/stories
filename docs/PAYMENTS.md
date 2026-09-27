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

## Phase 2 (planned)

Gateway orders created by a Cloud Function, signature verified server-side, webhooks processed idempotently by
event id (`paymentEvents/{eventId}`), refunds via the gateway. The client is never trusted to report success.
