# Stories — WhatsApp messages

Stories can send members and staff WhatsApp messages from a branch's own WhatsApp Business number, through Meta's
**WhatsApp Cloud API**:

- welcomes and plan activations;
- renewal reminders;
- issued and returned books, and reservations ready to collect;
- payment links and refunds;
- staff notifications.

Each branch connects its number by entering **three values** from Meta. Each message has its own **editable
template**.

- **Who sets it up:** a branch manager, franchise owner or head office (permission `messaging.manage`).
- **Where:** **Admin → Settings → WhatsApp**, for the branch chosen at the top of the page.

---

## Part 1 — Set up WhatsApp in Meta (once per business, about 30 minutes)

You need:

- a Facebook account;
- the business's details (name, address, website or social page);
- a **phone number for WhatsApp Business**: a mobile or landline that can receive an SMS or call. It must **not**
  already be on the WhatsApp or WhatsApp Business app. Delete it from the app first, or use a new number.

### Step 1. Create a business portfolio
1. Go to **business.facebook.com** and sign in.
2. Create a business portfolio (Business Manager) with your library's legal name and details.
3. *Recommended:* in **Business settings → Security centre**, start **Business verification**. Unverified businesses
   can message only 250 people a day; verification raises this to 1,000 and more.

### Step 2. Create a Meta app with WhatsApp
1. Go to **developers.facebook.com → My apps → Create app**.
2. For the use case, choose **"Connect with customers through WhatsApp"** (or *Other → Business*), and pick your
   business portfolio.
3. In the app, open **WhatsApp → API Setup**. Meta creates a WhatsApp Business Account (WABA) and a free *test
   number*.

### Step 3. Add your real phone number
1. **WhatsApp → API Setup → Add phone number.**
2. Enter the display name (usually your library or branch name; Meta reviews it) and the category.
3. Enter the number and verify it with the code Meta sends by SMS or voice call.
4. Repeat for each branch that will have its own number. Branches can also share one number.

### Step 4. Note the two IDs
On **WhatsApp → API Setup**, select your number in the *From* list. Copy:

- **Phone number ID**: a long number. This is per number, so each branch has its own.
- **WhatsApp Business Account ID**: shown just below it. All branches in the same WABA share it.

### Step 5. Create a permanent access token
The token on the API Setup page expires after 24 hours. Use a **System User** token, which doesn't expire:

1. **business.facebook.com → Business settings → Users → System users → Add.** Give it a name (e.g.
   "Stories") and the **Admin** role.
2. Select the system user → **Assign assets**:
   - **Apps:** your app, with **Full control**.
   - **WhatsApp accounts:** your WABA, with **Full control**.
3. Click **Generate new token**:
   - **App:** your app.
   - **Expiry:** **Never**.
   - **Permissions:** tick **`whatsapp_business_messaging`** and **`whatsapp_business_management`**.
4. Copy the token now; Meta shows it only once. Keep it like a password.

### Step 6. Copy the app secret (recommended)
**developers.facebook.com → your app → App settings → Basic → App secret → Show.** Stories uses it to check that
delivery updates really come from Meta.

### Step 7. Add a payment method
**WhatsApp Manager → Overview → Add payment method.** Meta charges per message for business-initiated *utility*
messages, which is what these are. Check current Indian pricing on Meta's "Pricing" page. Without a payment method,
only a small free tier is sent.

### Step 8. Make the app live
In development mode, Meta delivers only to the up-to-5 numbers listed under **API Setup → To**. When you're
ready, switch the app to **Live**: in the app dashboard, toggle *App mode*. This needs a privacy-policy URL in
**App settings → Basic**.

---

## Part 2 — Connect a branch in Stories (2 minutes per branch)

1. Sign in as the branch manager (or head office). Choose the branch at the top. Open **Admin → Settings →
   WhatsApp**.
2. Under **Connection**, enter:
   - **Phone number ID** (Step 4);
   - **WhatsApp Business Account ID** (Step 4);
   - **Permanent access token** (Step 5). It is write-only: Stories never shows it again, and you can leave it empty
     later to keep it;
   - **App secret** (Step 6), optional but recommended;
   - **Language of the messages**: English (`en`) by default, or Hindi, Tamil, and so on.
3. Click **Save and check with Meta**. Stories asks Meta about the number and shows *Connected: <name> · <number>*.
   A wrong value shows Meta's reason, for example *"Meta rejected the access token"*.
4. Under **Send a test message**, enter your mobile number and click **Send "hello_world"**. Every WhatsApp account
   has this Meta template, so a message within seconds means the connection works. In development mode the number
   must be one of the test recipients (Step 8).
5. **Webhook (delivery updates).** Open **Delivery updates (webhook)** and copy the **Callback URL** and **Verify
   token**. Then:
   1. In Meta, go to **your app → WhatsApp → Configuration → Webhook → Edit**, paste both and click **Verify and
      save**.
   2. Under **Webhook fields**, click **Manage** and **subscribe to `messages`** and
      **`message_template_status_update`**.

   The message log then shows *Delivered* and *Read*, a member who replies **STOP** stops getting messages, and
   template approvals and rejections appear on the page by themselves (no need to press *Check approvals*).

   One Meta app has **one** callback URL. If several branches share the app, paste the URL of any one of them:
   delivery updates, STOP replies and approvals still reach the whole organization. The `whatsappWebhook` function
   must be deployed first, or Meta's *Verify and save* fails.

**Other branches:**
- **Same number:** enter the same three values.
- **Own number:** enter that number's Phone number ID. The WABA ID and token are the same if it's in the same WABA.
- **Different business:** use that business's own values.

---

## Part 3 — Choose and word the messages (templates)

WhatsApp lets a business start a conversation only with a **template that Meta has approved**. Stories has one
template per message, and each branch has its own copy:

| Message | Sent when | Values it can use |
|---|---|---|
| Welcome | a member registers or signs up | member_name, branch_name, member_code |
| Plan activated | a plan is paid (counter or online) | member_name, branch_name, plan_name, amount, valid_until |
| Renewal reminder | 7 days and 1 day before a plan ends, if not renewed | member_name, branch_name, plan_name, valid_until, days_left |
| Books issued | books are issued (counter or exchange) | member_name, branch_name, book_titles |
| Books returned | books are returned | member_name, branch_name, book_titles |
| Reservation ready | a reserved book is set aside | member_name, branch_name, book_title, hold_until |
| Payment link | staff send an online payment link | member_name, branch_name, amount, payment_link |
| Refund | a refund is paid out or recorded | member_name, branch_name, amount |
| Staff notification | any in-app staff notification (leave decided, payslip ready, documents verified…) | employee_name, title, details |

For each message you want:

1. **Edit wording.** Change the text. Click a value chip (e.g. `{{member_name}}`) to insert it. The preview shows
   the message with sample values. Rules:
   - A message can't start or end with a value.
   - At most 1,024 characters.
   - Only the values listed for that message.
2. **Template name in Meta**: `stories_<message>` by default.
   - If several branches share one WABA but word a message differently, give each its own name (e.g.
     `stories_member_welcome_central`).
   - A name Meta rejected or deleted can't be reused for 30 days, so change it.
3. **Save**, then click **Submit to Meta**. Stories sends the wording (as `{{1}}`, `{{2}}`, … with sample values)
   for approval in the **Utility** category. Approval usually takes minutes, at most 24 hours.
4. Click **Check approvals**. The status changes to **Approved**, or **Rejected** with Meta's reason.
5. Tick **Send this message** (the card shows **On**), then **Send test** to your number.

You can also create templates directly in **WhatsApp Manager → Message templates**. Use the same name and language,
and write `{{1}}`, `{{2}}`, … in the order the values first appear in Stories' wording. **Check approvals** then
links them.

> Changing the wording or the name means submitting it again. Messages switched on in the last minute may take up
> to a minute to start going out.

---

## Part 4 — Members, consent and rules

- **Consent:** WhatsApp requires people to agree to get messages. Ask members at registration and mention it in your
  membership terms.
- **Opting out:**
  - A member who replies **STOP** gets no more WhatsApp messages. This needs the webhook from Part 2.
  - Staff can switch WhatsApp off or on for a member: *Edit member → Send WhatsApp updates*.
- **Who gets the message:**
  - Members get messages on their mobile number.
  - Children without a number: their **guardian** gets them.
  - Staff get messages on the phone in their employee record. Head-office staff get them from the first branch that
    sends staff notifications.
- **Quality:** Meta lowers the sending limit if many people block or report your number. Keep messages useful and
  switch off ones members don't want.

## Part 5 — Message log and troubleshooting

**Settings → WhatsApp → Message log** shows the latest 50 messages:

- **Sent / Delivered / Read** (delivered and read need the webhook);
- **Failed**, with Meta's reason;
- **Not sent**, with the reason: no mobile number, or the member opted out.

| You see | What it means / what to do |
|---|---|
| "Meta rejected the access token" | The token expired or lacks permissions: create a System User token (Step 5) and save it again. |
| "Meta won't let this access token use …" / "Unsupported post request. Object with ID … does not exist, cannot be loaded due to missing permissions" | The token can't reach that ID. In Business Settings → Users → System users → your system user → **Assign assets**, give it your **WhatsApp account** (and the app) with Full control; generate the token with **both** `whatsapp_business_messaging` and `whatsapp_business_management`; check the WhatsApp Business Account ID is the one on API Setup (not the App ID or Business ID). Save the connection again: Stories now checks the account and number when saving. |
| "(#131030) Recipient phone number not in allowed list" | The app is in development mode: add the number under API Setup → To, or make the app Live (Step 8). |
| Template **Rejected: INCORRECT_CATEGORY** | Meta thinks the wording is marketing rather than a transactional update (common for welcomes). Reword it as a plain account update, e.g. "Your membership at {{branch_name}} is registered. Member ID: {{member_code}}. Show it at the counter to borrow books.", save and submit again (same name is fine for a rejected template). |
| A template was **deleted in Meta** / "content is being deleted" when submitting | Meta blocks a deleted template's name (in that language) for 4 weeks. Press **Check approvals** (Stories marks it not submitted), open **Edit wording**, change the **Template name** (e.g. `stories_member_welcome_v2`), save and **Submit to Meta**. |
| Template stays **Waiting for Meta** | Utility reviews take minutes to 24 hours. Press **Check approvals**: it also tells you if a submitted template isn't in your WhatsApp account any more (sent with an older token, or deleted in Meta), or subscribe the webhook to `message_template_status_update` so it updates by itself. |
| "Template name does not exist in the translation" (132001) | The template isn't approved yet, or the name or language differs from Meta's. Use **Check approvals**. |
| "Number of parameters does not match" (132000) | The wording in Meta differs from Stories'. Submit again from Stories, or edit the template in Meta to match. |
| "Message failed to send because more than 24 hours…" (131047) | Only for free-form replies; Stories always uses templates. Check the template is approved. |
| "(#131026) Message undeliverable" | The number isn't on WhatsApp, or the person blocked the business. |
| Nothing in the log for a message | Is it switched **On** and is the connection enabled? Messages switched on less than a minute ago may not be queued yet. |

## Deploying

`npm run deploy:backend` deploys two new functions: `whatsapp-send` (a Firestore trigger) and `whatsappWebhook`.

- **First deploy:** it can take a few minutes longer. The Firebase CLI turns on the *Eventarc* API for the Firestore
  trigger; if it reports that Eventarc permissions are still propagating, wait a few minutes and run it again.
- **Region:** the trigger runs in `asia-south1`, which must be the Firestore database's region (Firebase console →
  Firestore → the database's *Location*). If the database is elsewhere, the deploy says so; change `REGION` for the
  trigger in `messaging/outbox.ts`.
- **After deploying:** connect each branch (Part 2).

## How it works (for developers)

- **Settings:**
  - Branch document `whatsapp`: `enabled`, `phoneNumberId`, `wabaId`, `displayPhone`, `verifiedName`,
    `hasAppSecret`, `language`.
  - Secrets in `orgs/{o}/branches/{b}/private/whatsapp`: `accessToken`, `appSecret`, `verifyToken`. No client can
    read them; Security Rules deny it.
  - Templates in `orgs/{o}/branches/{b}/whatsappTemplates/{event}`.
- **Switchboard:** `orgs/{o}/config/whatsapp.branches.{branchId}` lists the events each branch sends. Code that
  queues messages checks it through a one-minute in-memory cache, so organizations without WhatsApp write nothing.
- **Queue:** events are queued in the same transaction as the change they report, with `queueWhatsApp(tx, …)`,
  into `orgs/{o}/whatsappOutbox/{id}`:
  - registration (`members.ts`), payment (`subscriptions.ts writeSettlement`), issue and return (`circulation.ts`);
  - allocation (`allocation.ts`, `reservations.ts`), payment links (`online.ts`), refunds (`refunds.ts`);
  - staff notifications (`core/notify.ts`);
  - renewal reminders, from the hourly subscription sweep (`messaging/outbox.ts queueRenewalReminders`).
- **Sending:** the Firestore trigger `whatsapp-send` (`messaging/outbox.ts deliver`) runs once per queued message:
  1. It claims the message.
  2. It drops it if the branch or event is off.
  3. It finds the recipient (opt-out, guardian fallback).
  4. It fills the template's values in order of first use.
  5. It calls `POST /{phone-number-id}/messages`, then marks the message SENT (with the `wamid`), FAILED or SKIPPED.

  Queued messages keep `expireAt` (+90 days): turn on a Firestore TTL policy on `whatsappOutbox.expireAt` to clear
  old ones.
- **Webhook:** `whatsappWebhook?o=<orgId>&b=<branchId>`.
  - GET answers Meta's verification with the branch's verify token.
  - POST checks `X-Hub-Signature-256` against the app secret (when saved), records status updates by `wamid`, and
    sets `whatsappOptOut` on members whose number replied STOP.
- **Callables (admin router):** `whatsapp-overview`, `-saveConnection`, `-saveTemplate`, `-submitTemplate`,
  `-syncTemplates`, `-sendTest` and `-log`, all requiring `messaging.manage` at the branch.
- **Graph API version:** `v23.0` (`messaging/whatsapp.ts GRAPH`). Meta supports each version for about two years.
