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

export const templateDefaults = (orgId: string) => call<TemplateDefaults>('letterTemplates-defaults', { orgId });

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
