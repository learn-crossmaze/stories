// WhatsApp messages, set up per branch (functions/src/messaging, docs/WHATSAPP.md).
import { call, command, errorText } from './api';

export interface WhatsAppSettings {
  enabled: boolean;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string | null;
  verifiedName: string | null;
  hasAppSecret: boolean;
  language: string;
}

export interface EventVariable {
  key: string;
  label: string;
  sample: string;
}

export interface Template {
  event: string;
  enabled: boolean;
  name: string;
  language: string;
  body: string;
  status: string;
  reason: string | null;
  metaId: string | null;
}

export interface MessageEvent {
  key: string;
  label: string;
  audience: 'MEMBER' | 'STAFF';
  group: 'MEMBERSHIP' | 'PAYMENTS' | 'BORROWING' | 'RESERVATIONS' | 'DELIVERY' | 'STAFF';
  when: string;
  variables: EventVariable[];
  body: string;
  /** Set up for this branch (shown in its list); the rest can be added. */
  added: boolean;
  template: Template;
}

export interface Overview {
  settings: WhatsAppSettings | null;
  webhook: { path: string; verifyToken: string | null } | null;
  events: MessageEvent[];
}

export interface LoggedMessage {
  id: string;
  event: string;
  to: string | null;
  recipient: string | null;
  status: string;
  error: string | null;
  at: string | null;
}

export const LANGUAGES = [
  ['en', 'English'],
  ['en_US', 'English (US)'],
  ['en_GB', 'English (UK)'],
  ['hi', 'Hindi'],
  ['bn', 'Bengali'],
  ['gu', 'Gujarati'],
  ['kn', 'Kannada'],
  ['ml', 'Malayalam'],
  ['mr', 'Marathi'],
  ['pa', 'Punjabi'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['ur', 'Urdu'],
] as const;

const at = (orgId: string, branchId: string) => ({ orgId, branchId });

export const loadOverview = (orgId: string, branchId: string) => call<Overview>('whatsapp-overview', at(orgId, branchId));
export const saveConnection = (orgId: string, branchId: string, c: { enabled: boolean; phoneNumberId: string; wabaId: string; accessToken: string; appSecret: string; language: string }) =>
  command<{ displayPhone: string | null; verifiedName: string | null }>('whatsapp-saveConnection', { ...at(orgId, branchId), ...c });
export const saveTemplate = (orgId: string, branchId: string, t: Pick<Template, 'event' | 'enabled' | 'name' | 'language' | 'body'>) =>
  command<{ status: string }>('whatsapp-saveTemplate', { ...at(orgId, branchId), ...t });
/** Adds several notifications at once (default wording, switched off); ones the branch already has are left alone. */
export const addTemplates = (orgId: string, branchId: string, events: string[]) => command<{ added: string[] }>('whatsapp-addTemplates', { ...at(orgId, branchId), events });
/** Switches several of the branch's notifications on or off at once; ones it has not added are ignored. */
export const switchTemplates = (orgId: string, branchId: string, events: string[], enabled: boolean) =>
  command<{ switched: string[] }>('whatsapp-switchTemplates', { ...at(orgId, branchId), events, enabled });
export const removeTemplate = (orgId: string, branchId: string, event: string) => command<{ removed: boolean }>('whatsapp-removeTemplate', { ...at(orgId, branchId), event });
export const submitTemplate = (orgId: string, branchId: string, event: string) => call<{ status: string }>('whatsapp-submitTemplate', { ...at(orgId, branchId), event });
export const syncTemplates = (orgId: string, branchId: string) => call<{ statuses: Record<string, string>; found: number; missing: string[] }>('whatsapp-syncTemplates', at(orgId, branchId));
export const sendTest = (orgId: string, branchId: string, to: string, event: string | null) => call<{ wamid: string | null }>('whatsapp-sendTest', { ...at(orgId, branchId), to, event });
export const messageLog = (orgId: string, branchId: string) => call<{ messages: LoggedMessage[] }>('whatsapp-log', at(orgId, branchId));

/** What a branch's notifications still wait for, from its overview. */
export interface TemplateActions {
  /** Added, but not sent to Meta yet (or changed since): "Submit all to Meta" sends these. */
  toSubmit: MessageEvent[];
  /** Rejected, paused or disabled by Meta: the wording needs a change. */
  toFix: MessageEvent[];
  /** Approved but switched off: "Switch on all approved" turns these on. */
  toSwitchOn: MessageEvent[];
}

const TURNED_DOWN = ['REJECTED', 'PAUSED', 'DISABLED'];

export function templateActions(events: MessageEvent[]): TemplateActions {
  const added = events.filter((e) => e.added);
  return {
    toSubmit: added.filter((e) => e.template.status === 'NOT_SUBMITTED'),
    toFix: added.filter((e) => TURNED_DOWN.includes(e.template.status)),
    toSwitchOn: added.filter((e) => e.template.status === 'APPROVED' && !e.template.enabled),
  };
}

/**
 * How many of a branch's notifications wait for someone: not sent to Meta yet, or turned down by Meta. One that
 * is approved but switched off is not counted (it may be off on purpose). Only for people who may manage
 * messaging at the branch (whatsapp-overview refuses the rest).
 */
export async function templatesNeedingAction(orgId: string, branchId: string): Promise<number> {
  const { toSubmit, toFix } = templateActions((await loadOverview(orgId, branchId)).events);
  return toSubmit.length + toFix.length;
}

/** How many notifications "Submit all to Meta" sends at the same time. */
const SUBMIT_TOGETHER = 3;

export interface SubmitAllResult {
  /** Events Meta took for review, and those it refused (with its message). */
  sent: string[];
  failed: { event: string; label: string; error: string }[];
}

/**
 * Sends every added notification that is still "not submitted" to Meta, a few at a time. It first checks with
 * Meta (whatsapp-syncTemplates), so a template the business account already has is linked, not sent again;
 * that check can also add notifications, so the list is read afresh after it. One reworded since Meta saw it
 * stays "not submitted" through the check (the server keeps it so) and is sent. One failure never stops the rest.
 */
export async function submitAllTemplates(orgId: string, branchId: string, onProgress?: (done: number, total: number) => void): Promise<SubmitAllResult> {
  await syncTemplates(orgId, branchId);
  const { toSubmit } = templateActions((await loadOverview(orgId, branchId)).events);
  const result: SubmitAllResult = { sent: [], failed: [] };
  let next = 0;
  let done = 0;
  onProgress?.(0, toSubmit.length);
  const worker = async () => {
    while (next < toSubmit.length) {
      const e = toSubmit[next++];
      try {
        await submitTemplate(orgId, branchId, e.key);
        result.sent.push(e.key);
      } catch (err) {
        result.failed.push({ event: e.key, label: e.label, error: errorText(err) });
      }
      onProgress?.(++done, toSubmit.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SUBMIT_TOGETHER, toSubmit.length) }, worker));
  return result;
}

/** Placeholders in a body, in order of first use. */
export const placeholders = (body: string) => {
  const seen: string[] = [];
  for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
};
/** A body filled with sample values (the editor's preview). */
export const fillSamples = (body: string, variables: EventVariable[]) =>
  body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => variables.find((v) => v.key === k)?.sample ?? `{{${k}}}`);

/** Meta rejects templates with too many values for their length: Stories asks for 3 words of your own per value (functions/src/messaging/events.ts). */
export const WORDS_PER_VALUE = 3;
export const fixedWords = (body: string) =>
  body.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
