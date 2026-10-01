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
  /** Kind of transaction, for grouping in the "Add notification" list. */
  group: 'MEMBERSHIP' | 'PAYMENTS' | 'BORROWING' | 'RESERVATIONS' | 'STAFF';
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
    group: 'MEMBERSHIP',
    label: 'Welcome',
    audience: 'MEMBER',
    when: 'A member is registered at the counter or signs up.',
    variables: [...MEMBER, v('member_code', 'Member ID', 'CEN-M000123')],
    // A plain account update (Meta rejects welcomes that read like marketing as INCORRECT_CATEGORY).
    body: 'Hello {{member_name}}, your membership at {{branch_name}} is registered. Member ID: {{member_code}}. Show it at the counter to borrow books.',
  },
  {
    key: 'subscription_active',
    group: 'PAYMENTS',
    label: 'Plan activated',
    audience: 'MEMBER',
    when: 'A subscription payment is received (counter or online).',
    variables: [...MEMBER, v('plan_name', 'Plan', 'Learner · 4 books'), v('amount', 'Amount paid', '₹1,399'), v('valid_until', 'Valid until', '30 Dec 2026')],
    body: 'Hello {{member_name}}, we have received your payment of {{amount}} for the {{plan_name}} plan at {{branch_name}}. Your plan is now active and valid until {{valid_until}}. Happy reading!',
  },
  {
    key: 'renewal_reminder',
    group: 'MEMBERSHIP',
    label: 'Renewal reminder',
    audience: 'MEMBER',
    when: '7 days and 1 day before a plan ends (if not renewed yet).',
    variables: [...MEMBER, v('plan_name', 'Plan', 'Learner · 4 books'), v('valid_until', 'Ends on', '30 Dec 2026'), v('days_left', 'Days left', '7')],
    body: 'Hello {{member_name}}, your {{plan_name}} plan at {{branch_name}} ends on {{valid_until}} ({{days_left}} days left). Renew at the counter or in the Stories app to keep borrowing.',
  },
  {
    key: 'books_issued',
    group: 'BORROWING',
    label: 'Books issued',
    audience: 'MEMBER',
    when: 'Books are issued to a member (counter or exchange).',
    variables: [...MEMBER, v('book_titles', 'Book titles', 'The Jungle Book, Panchatantra')],
    body: 'Hello {{member_name}}, you have borrowed {{book_titles}} from {{branch_name}} today. Please take good care of the books and enjoy reading!',
  },
  {
    key: 'books_returned',
    group: 'BORROWING',
    label: 'Books returned',
    audience: 'MEMBER',
    when: 'Books are returned (counter or exchange).',
    variables: [...MEMBER, v('book_titles', 'Book titles', 'The Jungle Book')],
    body: 'Hello {{member_name}}, we have received {{book_titles}} back at {{branch_name}}. Thank you for returning them, and happy reading!',
  },
  {
    key: 'reservation_ready',
    group: 'RESERVATIONS',
    label: 'Reservation ready',
    audience: 'MEMBER',
    when: 'A reserved book is set aside for the member.',
    variables: [...MEMBER, v('book_title', 'Book title', 'The Jungle Book'), v('hold_until', 'Collect by', '3 Oct 2026, 6:00 pm')],
    body: 'Hello {{member_name}}, the book you reserved, {{book_title}}, is now ready for you at {{branch_name}}. Please collect it from the counter by {{hold_until}}, after which it goes to the next reader.',
  },
  {
    key: 'payment_link',
    group: 'PAYMENTS',
    label: 'Payment link',
    audience: 'MEMBER',
    when: 'Staff send an online payment link.',
    variables: [...MEMBER, v('amount', 'Amount', '₹1,399'), v('payment_link', 'Payment link', 'https://rzp.io/i/AbCd123')],
    body: 'Hello {{member_name}}, here is your secure link to pay {{amount}} to {{branch_name}}: {{payment_link}} . Please complete the payment to activate your plan. Thank you!',
  },
  {
    key: 'refund_processed',
    group: 'PAYMENTS',
    label: 'Refund',
    audience: 'MEMBER',
    when: 'A refund is paid out or recorded.',
    variables: [...MEMBER, v('amount', 'Amount', '₹500')],
    body: 'Hello {{member_name}}, {{branch_name}} has refunded {{amount}} to you. It may take a few days to reach your account.',
  },
  {
    key: 'plan_upgraded',
    group: 'PAYMENTS',
    label: 'Plan upgraded',
    audience: 'MEMBER',
    when: 'A member upgrades their plan mid-term (counter or online).',
    variables: [...MEMBER, v('plan_name', 'New plan', 'Explorer · 6 books'), v('amount', 'Amount paid', '₹640'), v('valid_until', 'Valid until', '30 Dec 2026')],
    body: 'Hello {{member_name}}, your plan at {{branch_name}} is now {{plan_name}}. We received {{amount}} after the credit for unused days. Valid until {{valid_until}}.',
  },
  {
    key: 'plan_ended',
    group: 'MEMBERSHIP',
    label: 'Plan ended',
    audience: 'MEMBER',
    when: 'A plan ends and the member has not renewed.',
    variables: [...MEMBER, v('plan_name', 'Plan', 'Learner · 4 books')],
    body: 'Hello {{member_name}}, your {{plan_name}} plan at {{branch_name}} has ended. Renew at the counter or in the Stories app to keep borrowing.',
  },
  {
    key: 'membership_status',
    group: 'MEMBERSHIP',
    label: 'Membership paused, resumed or closed',
    audience: 'MEMBER',
    when: 'Staff pause (suspend), resume or close a membership.',
    variables: [...MEMBER, v('status', 'New status', 'paused')],
    body: 'Hello {{member_name}}, your membership at {{branch_name}} is now {{status}}. Please contact the branch if you have any questions.',
  },
  {
    key: 'book_lost',
    group: 'BORROWING',
    label: 'Book declared lost',
    audience: 'MEMBER',
    when: 'A borrowed book is declared lost.',
    variables: [...MEMBER, v('book_title', 'Book title', 'The Jungle Book'), v('amount', 'Replacement charge', '₹350')],
    body: 'Hello {{member_name}}, {{book_title}} borrowed from {{branch_name}} is recorded as lost. Replacement charge: {{amount}}. Please contact the branch for details.',
  },
  {
    key: 'deposit_refunded',
    group: 'PAYMENTS',
    label: 'Deposit refunded',
    audience: 'MEMBER',
    when: "A member's security deposit is refunded on settlement.",
    variables: [...MEMBER, v('amount', 'Amount', '₹1,000')],
    body: 'Hello {{member_name}}, {{branch_name}} has refunded your security deposit of {{amount}}. Thank you for reading with us.',
  },
  {
    key: 'reservation_placed',
    group: 'RESERVATIONS',
    label: 'Added to waiting list',
    audience: 'MEMBER',
    when: 'A book is reserved and no copy is free yet (the member joins the waiting list).',
    variables: [...MEMBER, v('book_title', 'Book title', 'The Jungle Book')],
    body: 'Hello {{member_name}}, you are on the waiting list for {{book_title}} at {{branch_name}}. We will message you when it is ready to collect.',
  },
  {
    key: 'reservation_cancelled',
    group: 'RESERVATIONS',
    label: 'Reservation cancelled',
    audience: 'MEMBER',
    when: 'A reservation is cancelled (by staff or the member).',
    variables: [...MEMBER, v('book_title', 'Book title', 'The Jungle Book')],
    body: 'Hello {{member_name}}, your reservation for {{book_title}} at {{branch_name}} has been cancelled. You can reserve it again any time in the Stories app.',
  },
  {
    key: 'reservation_expired',
    group: 'RESERVATIONS',
    label: 'Reservation not collected',
    audience: 'MEMBER',
    when: 'A book set aside was not collected in time and the hold ends.',
    variables: [...MEMBER, v('book_title', 'Book title', 'The Jungle Book')],
    body: 'Hello {{member_name}}, your hold on {{book_title}} at {{branch_name}} has ended as it was not collected in time. You can reserve it again in the Stories app.',
  },
  {
    key: 'staff_alert',
    group: 'STAFF',
    label: 'Staff notification',
    audience: 'STAFF',
    when: 'Any staff notification in the app (leave decided, payslip ready, documents verified…).',
    variables: [v('employee_name', 'Employee name', 'Lata'), v('title', 'Notification', 'Your leave was approved'), v('details', 'Details', '2–3 Oct · Casual leave')],
    body: 'Hello {{employee_name}}, you have a new update in Stories: {{title}}. Details: {{details}}. Please open the Stories app to see more.',
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

/**
 * Meta rejects templates with "too many variables for its length". Stories asks
 * for at least this many words of fixed text per value, which Meta accepts.
 */
export const WORDS_PER_VALUE = 3;

/** Words in a body other than its {{values}}. */
export const fixedWords = (body: string) =>
  body.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Why Meta would reject the body as too short for its values, or null. */
export function tooFewWords(body: string): string | null {
  const values = placeholders(body).length;
  const words = fixedWords(body);
  const need = values * WORDS_PER_VALUE;
  if (words >= need) return null;
  return `Meta rejects messages with too many values for their length. With ${values} values, write at least ${need} words of your own around them (now ${words}).`;
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
