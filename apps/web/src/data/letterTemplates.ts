// Letter templates: offer, appointment and custom letters, per branch or organization-wide (docs/HRMS.md §13).
import { collection, getDocs } from 'firebase/firestore';

import { call, command } from './api';
import { openFile } from './files';
import type { LetterKind } from './offers';
import { services } from './services';

export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface LetterTemplate {
  id: string;
  name: string;
  kind: LetterKind;
  /** null = every branch. */
  branchId: string | null;
  subject: string;
  body: string;
  acceptance: boolean;
  status: TemplateStatus;
  updatedByEmail?: string | null;
  updatedAt?: unknown;
}

export interface TemplateText {
  name: string;
  kind: LetterKind;
  subject: string;
  body: string;
  acceptance: boolean;
}

export interface TemplateDefaults {
  builtIn: Record<'OFFER' | 'APPOINTMENT', TemplateText>;
  placeholders: Record<string, string>;
}

export async function listTemplates(orgId: string): Promise<LetterTemplate[]> {
  const snap = await getDocs(collection(services().db, `orgs/${orgId}/letterTemplates`));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LetterTemplate).sort((a, b) => a.name.localeCompare(b.name));
}

// The built-in wording is the same on every call, so it is asked for once per organization (the server still
// checks the caller there on that first call). The promise is kept, not the answer, so two dialogs opening
// together share one call; a failed call is forgotten, so Retry asks again.
const defaults = new Map<string, Promise<TemplateDefaults>>();
export function templateDefaults(orgId: string): Promise<TemplateDefaults> {
  let asked = defaults.get(orgId);
  if (!asked) {
    asked = call<TemplateDefaults>('letterTemplates-defaults', { orgId });
    defaults.set(orgId, asked);
    const mine = asked;
    mine.catch(() => {
      if (defaults.get(orgId) === mine) defaults.delete(orgId);
    });
  }
  return asked;
}

export const saveTemplate = (orgId: string, t: TemplateText & { templateId?: string; branchId: string | null }) =>
  command<{ templateId: string }>('letterTemplates-save', { orgId, ...t });
export const publishTemplate = (orgId: string, templateId: string) => command<{ templateId: string; replaced: string[] }>('letterTemplates-publish', { orgId, templateId });
export const archiveTemplate = (orgId: string, templateId: string, reason: string) => command('letterTemplates-archive', { orgId, templateId, reason });

/** Shows a template (as being edited) with sample values, marked PREVIEW. */
export const previewTemplate = (orgId: string, t: Omit<TemplateText, 'kind'> & { branchId: string | null }) =>
  openFile('letterTemplates-preview', { orgId, name: t.name, subject: t.subject, body: t.body, acceptance: t.acceptance, branchId: t.branchId });

const TOKEN = /\{\{\s*([A-Za-z]+)\s*\}\}/g;
/** Placeholders a text uses. */
export const usedPlaceholders = (text: string) => [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]))];
