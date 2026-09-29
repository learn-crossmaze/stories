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

`orgs/{o}/subscriptions`: PENDING_PAYMENT → ACTIVE → EXPIRED (or CANCELLED while unpaid).

- `subscriptions-create` / `me-subscribe` take the plan **and a billing option** (`duration`; optional when the plan
  has only one). They store a **plan snapshot** (option, months, list price, discount and its label, price actually
  charged, deposit, limit) and the amount due: plan fee + **deposit top-up** = plan deposit − current deposit balance (never negative). Plan changes never
  alter a subscription already sold (tested).
- Only one unpaid subscription per member; renewals open `renewalWindowDays` before the current term ends.
- **Renewal (D6):** paid before expiry → starts exactly when the current term ends (no gap, no overlap) and is
  recorded as the member's `nextSubscriptionId`; borrowing rolls over to it automatically at the boundary.
  Loans carry over (the limit is tracked on the member).
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
