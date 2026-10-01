// WhatsApp messages, set up per branch (functions/src/messaging, docs/WHATSAPP.md).
import { call, command } from './api';

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
  group: 'MEMBERSHIP' | 'PAYMENTS' | 'BORROWING' | 'RESERVATIONS' | 'STAFF';
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
export const removeTemplate = (orgId: string, branchId: string, event: string) => command<{ removed: boolean }>('whatsapp-removeTemplate', { ...at(orgId, branchId), event });
export const submitTemplate = (orgId: string, branchId: string, event: string) => call<{ status: string }>('whatsapp-submitTemplate', { ...at(orgId, branchId), event });
export const syncTemplates = (orgId: string, branchId: string) => call<{ statuses: Record<string, string>; found: number; missing: string[] }>('whatsapp-syncTemplates', at(orgId, branchId));
export const sendTest = (orgId: string, branchId: string, to: string, event: string | null) => call<{ wamid: string | null }>('whatsapp-sendTest', { ...at(orgId, branchId), to, event });
export const messageLog = (orgId: string, branchId: string) => call<{ messages: LoggedMessage[] }>('whatsapp-log', at(orgId, branchId));

/** Placeholders in a body, in order of first use. */
export const placeholders = (body: string) => {
  const seen: string[] = [];
  for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
};
/** A body filled with sample values (the editor's preview). */
export const fillSamples = (body: string, variables: EventVariable[]) =>
  body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => variables.find((v) => v.key === k)?.sample ?? `{{${k}}}`);
