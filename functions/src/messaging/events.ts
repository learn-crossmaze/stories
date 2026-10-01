// The messages Stories can send on WhatsApp (docs/WHATSAPP.md). Each event has
// the variables it can fill in and a default wording; each branch may switch
// an event on, reword it and name the Meta template it is approved as.

export interface EventVariable {
  key: string;
  label: string;
  /** Example value: shown in the editor and sent to Meta with the template for review. */
  sample: string;
}

export interface MessageEvent {
  key: string;
  label: string;
  /** Who receives it. */
  audience: 'MEMBER' | 'STAFF';
  /** When it is sent. */
  when: string;
  variables: EventVariable[];
  /** Default wording; {{variable}} placeholders, at most 1024 characters (Meta's limit). */
  body: string;
}

const v = (key: string, label: string, sample: string): EventVariable => ({ key, label, sample });
const MEMBER = [v('member_name', 'Member name', 'Asha Rao'), v('branch_name', 'Branch name', 'Stories Central')];

export const EVENTS: MessageEvent[] = [
  {
    key: 'member_welcome',
    label: 'Welcome',
    audience: 'MEMBER',
    when: 'A member is registered at the counter or signs up.',
    variables: [...MEMBER, v('member_code', 'Member ID', 'CEN-M000123')],
    body: 'Hello {{member_name}}, welcome to {{branch_name}}! Your member ID is {{member_code}}. Show it at the counter to borrow books.',
  },
  {
    key: 'subscription_active',
    label: 'Plan activated',
    audience: 'MEMBER',
    when: 'A subscription payment is received (counter or online).',
    variables: [...MEMBER, v('plan_name', 'Plan', 'Learner · 4 books'), v('amount', 'Amount paid', '₹1,399'), v('valid_until', 'Valid until', '30 Dec 2026')],
    body: 'Hello {{member_name}}, we received {{amount}} for {{plan_name}} at {{branch_name}}. Your plan is valid until {{valid_until}}. Happy reading!',
  },
  {
    key: 'renewal_reminder',
    label: 'Renewal reminder',
    audience: 'MEMBER',
    when: '7 days and 1 day before a plan ends (if not renewed yet).',
    variables: [...MEMBER, v('plan_name', 'Plan', 'Learner · 4 books'), v('valid_until', 'Ends on', '30 Dec 2026'), v('days_left', 'Days left', '7')],
    body: 'Hello {{member_name}}, your {{plan_name}} plan at {{branch_name}} ends on {{valid_until}} ({{days_left}} days left). Renew at the counter or in the Stories app to keep borrowing.',
  },
  {
    key: 'books_issued',
    label: 'Books issued',
    audience: 'MEMBER',
    when: 'Books are issued to a member (counter or exchange).',
    variables: [...MEMBER, v('book_titles', 'Book titles', 'The Jungle Book, Panchatantra')],
    body: 'Hello {{member_name}}, you borrowed {{book_titles}} from {{branch_name}}. Enjoy!',
  },
  {
    key: 'books_returned',
    label: 'Books returned',
    audience: 'MEMBER',
    when: 'Books are returned (counter or exchange).',
    variables: [...MEMBER, v('book_titles', 'Book titles', 'The Jungle Book')],
    body: 'Hello {{member_name}}, we received {{book_titles}} back at {{branch_name}}. Thank you!',
  },
  {
    key: 'reservation_ready',
    label: 'Reservation ready',
    audience: 'MEMBER',
    when: 'A reserved book is set aside for the member.',
    variables: [...MEMBER, v('book_title', 'Book title', 'The Jungle Book'), v('hold_until', 'Collect by', '3 Oct 2026, 6:00 pm')],
    body: 'Hello {{member_name}}, {{book_title}} is ready for you at {{branch_name}}. Please collect it by {{hold_until}}.',
  },
  {
    key: 'payment_link',
    label: 'Payment link',
    audience: 'MEMBER',
    when: 'Staff send an online payment link.',
    variables: [...MEMBER, v('amount', 'Amount', '₹1,399'), v('payment_link', 'Payment link', 'https://rzp.io/i/AbCd123')],
    body: 'Hello {{member_name}}, please pay {{amount}} to {{branch_name}} using this secure link: {{payment_link}} . Thank you!',
  },
  {
    key: 'refund_processed',
    label: 'Refund',
    audience: 'MEMBER',
    when: 'A refund is paid out or recorded.',
    variables: [...MEMBER, v('amount', 'Amount', '₹500')],
    body: 'Hello {{member_name}}, {{branch_name}} has refunded {{amount}} to you. It may take a few days to reach your account.',
  },
  {
    key: 'staff_alert',
    label: 'Staff notification',
    audience: 'STAFF',
    when: 'Any staff notification in the app (leave decided, payslip ready, documents verified…).',
    variables: [v('employee_name', 'Employee name', 'Lata'), v('title', 'Notification', 'Your leave was approved'), v('details', 'Details', '2–3 Oct · Casual leave')],
    body: 'Hello {{employee_name}}, {{title}}. {{details}}. Open the Stories app for details.',
  },
];

export const EVENT_KEYS = EVENTS.map((e) => e.key) as [string, ...string[]];
export const eventFor = (key: string) => EVENTS.find((e) => e.key === key);

/** Placeholders in a body, in order of first use (they become Meta's {{1}}, {{2}}, …). */
export function placeholders(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** The body as Meta wants it: {{1}}, {{2}}, … in order of first use. */
export const metaBody = (body: string) => {
  const keys = placeholders(body);
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => `{{${keys.indexOf(k) + 1}}}`);
};

/** Fills a body with values (for previews and test sends). */
export const fill = (body: string, values: Record<string, string>) => body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => values[k] ?? '');

/** A Meta template name: lower-case letters, digits and underscores. */
export const defaultTemplateName = (event: string) => `stories_${event}`;
