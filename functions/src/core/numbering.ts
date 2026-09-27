import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';

import { reserveCounter, pad } from './counters.js';
import { errors } from './errors.js';
import { db } from './firebase.js';
import { dateKeyIST } from './time.js';

/**
 * Numbering patterns ("nomenclature") for the codes Stories generates, e.g.
 * `COPY-{BOOK}-{SEQ:2}` → COPY-000123-04. Each branch may override the
 * defaults for the codes it creates (branches/{b}.numbering); book codes are
 * global because the catalogue is shared (config/numbering). Changing a
 * pattern only affects new records — printed labels never change.
 *
 * Tokens: {SEQ} or {SEQ:n} (running number, zero-padded to n digits; exactly
 * once), {BRANCH} (branch code), {BOOK} (catalogue number, 6 digits),
 * {KIND} (shelf type: SH, DS, DK, BR), {YYYY}, {YY}, {MM} (date in India).
 */
export type CodeKind = 'book' | 'copy' | 'member' | 'location' | 'employee';
export const BRANCH_KINDS = ['copy', 'member', 'location', 'employee'] as const;
export type BranchKind = (typeof BRANCH_KINDS)[number];

export const DEFAULT_PATTERNS: Record<CodeKind, string> = {
  book: 'BOOK-{SEQ:6}',
  copy: 'COPY-{BOOK}-{SEQ:2}',
  member: 'MEM-{SEQ:6}',
  location: '{KIND}-{SEQ:3}',
  employee: 'EMP-{SEQ:4}',
};

const DATE_TOKENS = ['YYYY', 'YY', 'MM'];
export const TOKENS: Record<CodeKind, string[]> = {
  book: [...DATE_TOKENS],
  copy: ['BRANCH', 'BOOK', ...DATE_TOKENS],
  member: ['BRANCH', ...DATE_TOKENS],
  location: ['BRANCH', 'KIND'],
  employee: ['BRANCH', ...DATE_TOKENS],
};

/** Longest code each kind may produce (copy codes double as barcodes). */
export const MAX_LENGTH: Record<CodeKind, number> = { book: 24, copy: 32, member: 24, location: 16, employee: 24 };

export const LOCATION_KIND_CODES: Record<string, string> = { SHELF: 'SH', DISPLAY: 'DS', DESK: 'DK', BACKROOM: 'BR' };

const PART = /\{([A-Z]+)(?::(\d))?\}|[A-Z0-9-]/g;
const SAMPLE: Record<string, string> = { BRANCH: 'BRANCH01', BOOK: '000000', KIND: 'SH', YYYY: '2026', YY: '26', MM: '09' };

/** Returns a problem with `pattern` for codes of `kind`, or null if it is usable. */
export function patternProblem(kind: CodeKind, pattern: string): string | null {
  const parts = pattern.match(PART) ?? [];
  if (parts.join('') !== pattern) return 'may only use capital letters, digits, dashes and {TOKENS}';
  let seq = 0;
  let longest = 0;
  for (const p of parts) {
    const m = /^\{([A-Z]+)(?::(\d))?\}$/.exec(p);
    if (!m) {
      longest += 1;
      continue;
    }
    const [, name, width] = m;
    if (name === 'SEQ') {
      seq += 1;
      if (width === '0') return '{SEQ:n} needs n from 1 to 9';
      longest += Math.max(Number(width ?? 1), 3);
    } else if (!TOKENS[kind].includes(name) || width) {
      return `{${name}${width ? `:${width}` : ''}} can't be used here (allowed: ${['SEQ', ...TOKENS[kind]].map((t) => `{${t}}`).join(' ')})`;
    } else {
      longest += SAMPLE[name].length;
    }
  }
  if (seq !== 1) return 'must contain {SEQ} (or {SEQ:n}) exactly once';
  if (longest > MAX_LENGTH[kind]) return `makes codes longer than ${MAX_LENGTH[kind]} characters`;
  if (longest < 2) return 'is too short';
  return null;
}

/** zod field for an optional pattern override ('' = use the default). */
export const patternField = (kind: CodeKind) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .superRefine((p, ctx) => {
      const problem = p === '' ? null : patternProblem(kind, p);
      if (problem) ctx.addIssue({ code: 'custom', message: `Pattern ${problem}` });
    });

export type TokenValues = Partial<Record<'BRANCH' | 'BOOK' | 'KIND', string>>;

function fill(pattern: string, values: TokenValues, now: Date, seq: (width: number) => string) {
  const day = dateKeyIST(now);
  const all: Record<string, string> = { ...values, YYYY: day.slice(0, 4), YY: day.slice(2, 4), MM: day.slice(5, 7) };
  return pattern.replace(/\{([A-Z]+)(?::(\d))?\}/g, (_, name: string, width?: string) =>
    name === 'SEQ' ? seq(Number(width ?? 1)) : (all[name] ?? ''),
  );
}

export const renderCode = (pattern: string, values: TokenValues, n: number, now = new Date()) =>
  fill(pattern, values, now, (w) => pad(n, w));

/** The catalogue number used by {BOOK}: stored on new books, parsed from older BOOK-000123 codes. */
export function bookNumber(book: DocumentSnapshot): string {
  const n = (book.get('number') as number | undefined) ?? Number(/(\d+)$/.exec(book.get('code') as string)?.[1] ?? 0);
  return pad(n, 6);
}

/**
 * Counter documents: codes whose fixed parts render the same share one
 * running number, so a pattern never repeats a code (and a pattern with {YY}
 * starts again at 1 each year). Books always share one catalogue number,
 * which {BOOK} relies on being unique. The default patterns keep the counters
 * used before patterns were configurable.
 */
function counterPath(kind: CodeKind, pattern: string, values: TokenValues, base: string, now: Date, bookCode?: string) {
  if (kind === 'book') return 'counters/books';
  if (pattern === DEFAULT_PATTERNS[kind]) {
    if (kind === 'copy') return `${base}/copies-${bookCode}`;
    if (kind === 'member') return `${base}/members`;
  }
  return `${base}/${kind}:${fill(pattern, values, now, () => '#')}`;
}

/** Patterns in effect at a branch (its overrides over the defaults). */
export function branchPatterns(branch: DocumentSnapshot | null): Record<BranchKind, string> {
  const own = (branch?.get('numbering') ?? {}) as Partial<Record<BranchKind, string>>;
  return Object.fromEntries(BRANCH_KINDS.map((k) => [k, own[k] || DEFAULT_PATTERNS[k]])) as Record<BranchKind, string>;
}

export async function bookPattern(tx: Transaction) {
  const snap = await tx.get(db.doc('config/numbering'));
  return (snap.get('book') as string | undefined) || DEFAULT_PATTERNS.book;
}

/**
 * Reserves `count` codes (a read — call before any writes; then `commit()`).
 * `taken(codes)` looks the candidates up and returns those already in use,
 * e.g. by records numbered under an earlier pattern.
 */
export async function reserveCodes(
  tx: Transaction,
  opts: {
    kind: CodeKind;
    pattern: string;
    values: TokenValues;
    /** Counter collection: `counters` (catalogue), `orgs/{o}/counters`, or a branch's for shelves. */
    base: string;
    count?: number;
    bookCode?: string;
    taken?: (codes: string[]) => Promise<string[]>;
  },
) {
  const now = new Date();
  const count = opts.count ?? 1;
  const counter = await reserveCounter(tx, counterPath(opts.kind, opts.pattern, opts.values, opts.base, now, opts.bookCode));
  const codes = Array.from({ length: count }, (_, i) => renderCode(opts.pattern, opts.values, counter.value + i, now));
  const clash = opts.taken ? await opts.taken(codes) : [];
  if (clash.length) {
    throw errors.conflict(
      'CODE_TAKEN',
      `The numbering pattern ${opts.pattern} produced ${clash[0]}, which is already in use. Change the pattern in the numbering settings.`,
    );
  }
  return { codes, number: counter.value, commit: () => counter.commit(count) };
}

/** Finds which of `codes` already exist in `collection` (field `code`). */
export async function existingCodes(tx: Transaction, collection: string, codes: string[]) {
  const found: string[] = [];
  for (let i = 0; i < codes.length; i += 30) {
    const snap = await tx.get(db.collection(collection).where('code', 'in', codes.slice(i, i + 30)));
    found.push(...snap.docs.map((d) => d.get('code') as string));
  }
  return found;
}
