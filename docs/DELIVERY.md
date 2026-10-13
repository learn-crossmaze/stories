# Stories — Home delivery

Branches take books to members' homes and collect them back. A visit goes out in one of three ways:

| Way | What happens | Set up |
|---|---|---|
| **Own staff** | A staff member with the *Delivery person* role (or a librarian or manager) rides out. They report the visit in **Staff → My deliveries** on their phone. | Grant the *Delivery person* role at the branch (Roles & access). |
| **Other courier** | Any courier or local runner. Staff enter its name, reference/AWB and an optional tracking link, then report the outcome by hand. | Nothing. |
| **Courier app (Porter)** | Stories books a rider through the courier's API, follows the order and closes the visit when the courier drops the books. | An API key from the courier (§4). |

Code: `functions/src/delivery` (orders, settings, couriers, webhook, member actions) and
`apps/web/src/admin/circulation/Deliveries.tsx`, `admin/organization/DeliverySettings.tsx`, `member/HomeDelivery.tsx`.

## 1. Branch settings (Admin → Settings → Delivery)

Who: `delivery.configure` (head office, franchise owner, branch manager). Stored on the branch (`delivery`); the
courier API keys and the webhook token are in `branches/{b}/private/delivery`, which no client can read.

- **Offer home delivery**: switches the service on for the branch (the member app shows *Home delivery* on My Books).
- **Fee per visit**: in rupees, 0 = free. The fee is recorded on each visit as *due* and collected at the door (cash,
  UPI or card, by the rider) or later at the counter (*Record fee*). It can be waived when dispatching or afterwards.
  A collected fee is a payment with purpose `DELIVERY_FEE`, so it appears in Payments & refunds.
- **PIN codes**: the PIN codes the branch delivers to. Empty = any.
- **Time slots**: e.g. `10:00–13:00`, one per line. Empty = no slots (the branch calls to fix a time).
- **Branch map location**: paste a Google Maps link or `lat, lng`, or use the device's location. Courier apps need it
  as the pickup point.
- **Ways to deliver**: own staff, other couriers, and each courier app (with its API key and *Live*/*Test* account).

## 2. Booking a visit

A visit is a **Delivery** (books to the member), a **Pickup** (books back) or an **Exchange** (both in one visit).

- **At the branch**: Operations → Circulation → **Deliveries** → *New delivery*: find the member, choose the type,
  date, time slot, the ready reservations to bring, the borrowed books to collect, the address (with an optional map
  pin) and a note ("any two adventure books").
- **In the member app** (My Books → *Home delivery*): the member (or a guardian for a child) books from their home
  branch. Members may book only when their **plan includes home delivery** (Plans → *home delivery*): a delivery or
  exchange needs an active plan with delivery; a pickup needs the current or latest plan to include it. Staff may
  book for anyone.

Rules (both): the branch delivers (switched on, PIN code accepted), the date is today to 14 days ahead, the slot is one
of the branch's, the reservations are the member's and ready at this branch, the books to collect are on loan to the
member, and the member has **no other visit open**. Members may cancel until it is dispatched. Nothing moves until
dispatch; the member gets the *Home delivery booked* WhatsApp message.

## 3. Dispatch, the visit, and returns

```
REQUESTED ──dispatch──▶ OUT ──visit reported──▶ RETURNING ──branch receives──▶ COMPLETED / FAILED
    │                    │                        (only when books come back)
    └──cancel──▶ CANCELLED └──▶ COMPLETED (nothing to bring back) / FAILED (nothing was sent)
```

- **Dispatch** (`delivery.assign`: librarian, manager, owner): scan the books going out (ready reservations are filled
  in), choose the way (own staff → who; other courier → name, reference, tracking link; courier app → *Get fare* shows
  Porter's quote), optionally waive the fee. In one transaction the books are **issued to the member** with the
  desk's own rules (active plan, plan limit, a reserved copy only to its member; the loans carry `channel: DELIVERY`
  and the `deliveryId`). For an exchange, the books being collected count as already returned for the plan limit.
  The member gets *Books on the way* (or *Pickup on the way*) with who is coming.
- **The visit**: the rider (only the one assigned, or anyone with `delivery.manage`) reports **Delivered** — who
  received it, which borrowed books they collected, and the fee if collected — or **Couldn't deliver** with the
  reason. The member gets *Delivery completed* or *Delivery not completed*.
- **Back at the branch**: when books come back (collected ones, or books that could not be delivered), the visit
  waits in *Coming back*. **Receive books** returns them through the desk's return code: loans close, copies go to
  inspection, the member's count drops. Books from a failed delivery are marked `returnReason: DELIVERY_FAILED`.
  A reservation filled by a failed delivery is not restored: the member reserves again.
- **Cancel**: before dispatch the visit just closes. Once out, the books sent come back to be received, and a booked
  courier is cancelled through its API (if that fails, the board says to cancel it in the courier's app too).

The Operations dashboard lists visits to dispatch and bags to receive.

## 4. Courier apps (Porter)

Porter's business API books two-wheelers within its cities. Ask Porter for API access on
[porter.in/api-integrations](https://porter.in/api-integrations); they send an API key and the API contract.

1. Admin → Settings → Delivery: set the **branch map location**, tick **Book Porter from the dispatch screen**, paste
   the **API key**, choose **Live** (or **Test** for Porter's UAT environment), Save.
2. Open **Status updates (webhook)** and send the URL to Porter's API team so rider updates reach Stories instantly.
   Without it, Stories asks Porter when the Deliveries board is opened (at most once a minute per order, Porter's limit)
   and when staff press *Refresh status*.
3. Members' addresses need a **map pin** (they can use *Use my current location* in the app; staff can paste a Google
   Maps link).

How it works (`functions/src/delivery/couriers.ts`):

| Call | Porter API v1 (`x-api-key` header) |
|---|---|
| Fare | `GET /v1/get_quote` with pickup and drop coordinates and the customer's mobile; Stories shows each vehicle's fare and pickup time |
| Book | `POST /v1/orders/create` with `request_id` = the delivery id (a retry uses `<id>-2`, `-3`…), pickup and drop addresses with coordinates and contacts, and instructions |
| Track | `GET /v1/orders/{order_id}`: status, rider (name, phone, vehicle), fare |
| Cancel | `POST /v1/orders/{order_id}/cancel` |

Hosts: `https://pfe-apigw.porter.in` (Live), `https://pfe-apigw-uat.porter.in` (Test). Porter's states map to Stories'
as *Finding a rider* (open), *Rider on the way* (accepted), *Picked up* (live), *Dropped* (ended) and *Cancelled by
courier*. When Porter drops a **delivery**, the visit completes; when it drops a **pickup** at the branch, the bag
waits in *Coming back* to be received. Porter carries one way, so an exchange goes with own staff, or as a delivery
and a pickup. Porter does not take cash on delivery; its fare is charged to your Porter account and is separate
from the member's delivery fee.

- **Booking happens after the dispatch commits**: if Porter refuses (e.g. location not serviceable), the books are
  already out and the board shows *Booking failed* with Porter's reason and **Book again** (or cancel the visit).
  Courier errors are shown in plain words.
- **Webhook**: `…/deliveryWebhook?o=<orgId>&b=<branchId>&t=<token>`. The token proves the call is for the branch.
  The body only tells Stories which order changed (`order_id`); Stories then asks Porter for the order itself, and
  falls back to the event's status if Porter cannot answer.
- **Confirm with your credentials**: Porter shares its full API contract with business accounts only. The calls above
  follow that contract; if Porter's team gives you a different path or field, change it in one place
  (`couriers.ts`).

### Adding another courier (Borzo, Shadowfax, Uber Direct…)

Each courier is one adapter with four calls — `quote`, `book`, `track`, `cancel` — in `couriers.ts`, plus its entry in
`COURIERS` and a status map. The settings page, dispatch screen, webhook and board pick it up automatically.

## 5. Permissions

| Permission | Roles | Allows |
|---|---|---|
| `delivery.configure` | HO, FO, BM | Settings → Delivery, courier keys, webhook URL |
| `delivery.manage` | FO, BM, LIB | The board, booking visits, reporting for a rider, receiving, cancelling, fees |
| `delivery.assign` | FO, BM, LIB | Dispatching, fares, booking the courier |
| `delivery.execute` | DEL | My deliveries: reporting the visits assigned to them |

Members book and cancel their own visits (`me-requestDelivery`, `me-cancelDelivery`), checked by ownership like other
`me-*` actions. Deliveries are read only through functions (Security Rules deny clients).

## 6. Data

`orgs/{o}/deliveries/{id}`: `branchId`, member (`memberId`, `memberCode`, `memberName`, `phone` — the guardian's for a
child), `kind`, `status`, `address` (lines, landmark, city, state, PIN, `geo`), `date`, `slot`, `note`, `holdIds` +
`holdTitles`, `collectLoanIds` + `collectTitles`, `sent[]` and `collected[]` (`loanId`, `copyId`, `copyCode`,
`bookTitle`), `fee` (`amountMinor`, `status` FREE/DUE/PAID, `paymentId`, `method`), `method` (OWN, MANUAL, PORTER),
`rider`, `courier`, `provider` (`key`, `orderId`, `status`, `raw`, `trackingUrl`, `fareMinor`, `partner`, `error`,
`attempts`, `syncedAt`), `outcome`, `failReason`, `handedTo`, `requestedBy` and timestamps (`requestedAt`,
`dispatchedAt`, `reportedAt`, `receivedAt`, `cancelledAt`, `closedAt`). Indexes: member + status, member +
requestedAt, branch + status + requestedAt, branch + closedAt, rider + status.

Callables: `deliveries-*` on the `circulation` router (settings, saveSettings, create, list, get, mine, dispatch, quote,
book, sync, report, receive, cancel, recordFee); `me-requestDelivery` and `me-cancelDelivery` on the `members` router.
HTTP: `deliveryWebhook`. WhatsApp events (docs/WHATSAPP.md): *Home delivery booked*, *Books on the way*, *Pickup on
the way*, *Delivery completed*, *Delivery not completed*.

## 7. Deploying

`npm run deploy:backend` deploys the new `deliveryWebhook` function, the delivery actions and the Firestore indexes
(they build in a few minutes). Then set up each branch (§1) and mark the plans that include home delivery.
