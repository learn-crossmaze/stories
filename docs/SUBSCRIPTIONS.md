# Stories — Plans, subscriptions and deposits

## Plans

`orgs/{o}/plans/{planId}` (managed with `plans.manage`, head office). Fields: name, duration (MONTHLY 1 /
QUARTERLY 3 / HALF_YEARLY 6 / ANNUAL 12 months), price, security deposit, books at a time, audiences
(CHILDREN/TEENS/ADULTS), home-delivery eligibility, optional promotional price with a date window (IST), renewal
window (days before expiry). **Every edit is a new version** (`plans/{id}/versions/{n}`); archiving stops sales.

## Subscriptions

`orgs/{o}/subscriptions`: PENDING_PAYMENT → ACTIVE → EXPIRED (or CANCELLED while unpaid).

- `subscriptions-create` stores a **plan snapshot** (price actually charged, deposit, limit, months) and the amount
  due: plan fee + **deposit top-up** = plan deposit − current deposit balance (never negative). Plan changes never
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
ledger entry** (`functions/src/subscriptions/ledger.ts`), so balance = Σ ledger (tested). DEPOSIT_HOLD is not
needed (the whole balance is held until settlement).

- **Adjustments are maker-checker:** `deposits-proposeAdjustment` (`deposits.adjust`) creates a PENDING request;
  `deposits-decide` (`deposits.approve`, Finance) posts it. The proposer cannot approve their own request above
  `orgs/{o}/config/deposits.makerCheckerThresholdMinor` (default 0 = always a second person). Lost books create a
  proposal automatically.
- **Settlement:** `deposits-startSettlement` once the term has ended and every book is back (account → SETTLING,
  new subscriptions blocked) → resolve pending adjustments → `deposits-refund` (`deposits.refund`) pays out the
  balance, records an outgoing payment and closes the account (balance 0).
