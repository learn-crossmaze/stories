# Stories — Plans, subscriptions and deposits

## Plans

`orgs/{o}/plans/{planId}` (managed with `plans.manage`, head office). One plan (e.g. *Learner · 4 books*) holds:

- **Terms:** name, description, books at a time, security deposit, audiences (CHILDREN/TEENS/ADULTS),
  home-delivery eligibility, renewal window (days before expiry).
- **Billing options** (`options`): one to four of MONTHLY (1 month), QUARTERLY (3), HALF_YEARLY (6) and ANNUAL
  (12, shown as *Yearly*), each with its own price for the whole period. Stored shortest first.
- **Promotional discount** (`discount`, optional): `type` AMOUNT (paise off) or PERCENT (1–90 % off, rounded to whole
  rupees), a date window `from`–`to` (IST), `durations` it applies to (empty = every option), and an optional
  `label` shown to members (default "10% off" / "Rs. 100 off"). An amount off must be less than the price of every
  option it covers. The price never goes below zero.
- **Every edit is a new version** (`plans/{id}/versions/{n}`); archiving stops sales.
- **Older plans** (one `duration` + `priceMinor`, maybe a fixed `promo` price) keep working as a plan with one
  option; saving such a plan converts it to options.

Pricing lives in `priceFor()` / `pricesFor()` (`functions/src/billing/plans.ts`, mirrored in `apps/web/src/data/billing.ts`
for display; the server's price is the one charged).

## Subscriptions

`orgs/{o}/subscriptions`: PENDING_PAYMENT → ACTIVE → EXPIRED (or CANCELLED while unpaid; UPGRADED when a mid-term
upgrade replaces it).

- `subscriptions-create` / `me-subscribe` take the plan **and a billing option** (`duration`; optional when the plan
  has only one). They store a **plan snapshot** (option, months, list price, discount and its label, price actually
  charged, deposit, limit) and the amount due: plan fee + **deposit top-up** = plan deposit − current deposit balance (never negative). Plan changes never
  alter a subscription already sold (tested).
- Only one unpaid subscription per member; renewals open `renewalWindowDays` before the current term ends.
- **Renewal (D6):** paid before expiry → starts exactly when the current term ends (no gap, no overlap) and is
  recorded as the member's `nextSubscriptionId`; borrowing rolls over to it automatically at the boundary.
  Loans carry over (the limit is tracked on the member).
- **Upgrade mid-term, pro-rated (D7):** a member on an active plan can move to a bigger one at any time
  (*Upgrade plan* on the member page; *Upgrade now* on the member app's Membership tab). The new plan **starts on
  the day it is paid, for its full billing period**, and the days left on the current term are credited:

  | Line | How it is worked out |
  |---|---|
  | Credit | current term's plan price × **unused days** ÷ **days in the term**, rounded **down to whole rupees**. Unused days are whole days from now to the term's end (today counts as used). |
  | Plan fee now | the new plan's price today (with any running discount) − credit |
  | Deposit top-up | new plan's deposit − deposit already held (never negative), as for any plan |
  | Total | plan fee + deposit top-up |

  *Example:* Starter monthly (₹299, 30-day term), 20 days left → credit ₹299 × 20 ÷ 30 = ₹199. Upgrading to Learner
  monthly (₹499, deposit ₹1,500 vs ₹1,000 held): plan fee ₹499 − ₹199 = ₹300, deposit top-up ₹500, total ₹800;
  Learner runs a full month from the day it is paid.

  - **What counts as an upgrade:** more books at a time (any billing period), or as many books for a longer period
    (monthly → yearly); the price must be more than the credit. Fewer books, or a cheaper change, waits for renewal.
  - **Not possible** while another plan is waiting for payment, when the next term is already pre-paid, on the last
    day of a term (renew instead), while the deposit is being settled, or for an inactive membership.
  - **Quote first:** `subscriptions-upgradeQuote` / `me-upgradeQuote` list every eligible plan and billing option
    with the credit, fee, deposit, total and the new term's dates; the page shows the working
    (*₹1,399 × 50 days left ÷ 90 days = ₹777*). `subscriptions-upgrade` / `me-upgrade` then create the upgrade as a
    subscription waiting for payment (`kind: UPGRADE`, `upgrade`: plan replaced, term days, unused days, credit, new
    price, `validUntil`), paid at the counter or online like any plan; the breakdown is shown with the payment.
  - **The price holds until the end of the next day (IST).** After that it can't be paid (`UPGRADE_STALE`) and
    payment links for it close; upgrading again cancels the lapsed one and quotes afresh, so the credit always matches
    the days actually left. Payment is also refused if the plan being upgraded is no longer the current one.
  - **On payment** (same transaction): the old term becomes `UPGRADED` (`endedAt`, `upgradedToSubscriptionId`), the
    new one is ACTIVE from now, the member's plan, limit and renewal date change at once, the deposit top-up is
    collected, and the payment records the credit (`upgrade.creditMinor`, `unusedDays`). Books already out stay out;
    the new limit applies to the next issue.
- **Expiry** (`subscriptions-expireSweep`, hourly, idempotent) marks ended terms EXPIRED and moves members onto a
  pre-paid renewal. Borrowing checks use the clock directly, so a late sweep never lets an expired member borrow.
  After expiry: no new borrowing/exchanges/reservations, existing loans stay, returns allowed, deposit held.

## Security deposit (BUSINESS_RULES 9–10, §28–29)

`orgs/{o}/depositAccounts/{memberId}` (balance, status OPEN / SETTLING / CLOSED) with an append-only ledger
`transactions`: DEPOSIT_COLLECTED, DEPOSIT_DEDUCTION, DEPOSIT_ADJUSTMENT, DEPOSIT_REFUND — each with amount,
balance after, reason, reference, created by, approved by. **The balance changes only in the same transaction as a
ledger entry** (`functions/src/billing/ledger.ts`), so balance = Σ ledger (tested). DEPOSIT_HOLD is not
needed (the whole balance is held until settlement).

- **Adjustments are maker-checker:** `deposits-proposeAdjustment` (`deposits.adjust`) creates a PENDING request;
  `deposits-decide` (`deposits.approve`, Finance) posts it. The proposer cannot approve their own request above
  `orgs/{o}/config/deposits.makerCheckerThresholdMinor` (default 0 = always a second person). Lost books create a
  proposal automatically.
- **Settlement:** `deposits-startSettlement` once the term has ended and every book is back (account → SETTLING,
  new subscriptions blocked) → resolve pending adjustments → `deposits-refund` (`deposits.refund`) pays out the
  balance, records an outgoing payment and closes the account (balance 0).
