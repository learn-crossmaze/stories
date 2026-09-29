/**
 * Numbering patterns — mirrors functions/src/core/numbering.ts so the settings
 * dialogs can check patterns and preview codes as you type. The server has
 * the final say.
 */
export type CodeKind = 'book' | 'copy' | 'member' | 'location' | 'employee';
export type BranchKind = Exclude<CodeKind, 'book'>;
export const BRANCH_KINDS: BranchKind[] = ['copy', 'member', 'location', 'employee'];

export const DEFAULT_PATTERNS: Record<CodeKind, string> = {
  book: 'BOOK-{SEQ:6}',
  copy: 'BK{BOOK}-CP{SEQ:2}',
  member: '{BRANCH}-M{SEQ:6}',
  location: '{BRANCH}-{KIND}-{SEQ:3}',
  employee: '{BRANCH}-E{SEQ:4}',
};

const DATE_TOKENS = ['YYYY', 'YY', 'MM'];
export const TOKENS: Record<CodeKind, string[]> = {
  book: [...DATE_TOKENS],
  copy: ['BRANCH', 'BOOK', ...DATE_TOKENS],
  member: ['BRANCH', ...DATE_TOKENS],
  location: ['BRANCH', 'KIND'],
  employee: ['BRANCH', ...DATE_TOKENS],
};

export const TOKEN_HELP: Record<string, string> = {
  SEQ: 'running number; {SEQ:4} pads it to 4 digits (0001)',
  BRANCH: 'branch code',
  BOOK: 'catalogue number of the title (000123)',
  KIND: 'shelf type: SH shelf, DS display, DK desk, BR back room',
  YYYY: 'year (2026)',
  YY: 'short year (26)',
  MM: 'month (09)',
};

const MAX_LENGTH: Record<CodeKind, number> = { book: 24, copy: 32, member: 24, location: 16, employee: 24 };
const PART = /\{([A-Z]+)(?::(\d))?\}|[A-Z0-9-]/g;
const SAMPLE: Record<string, string> = { BRANCH: 'BRANCH01', BOOK: '000000', KIND: 'SH', YYYY: '2026', YY: '26', MM: '09' };

export function patternProblem(kind: CodeKind, pattern: string): string | null {
  const parts = pattern.match(PART) ?? [];
  if (parts.join('') !== pattern) return 'Use only capital letters, digits, dashes and {TOKENS}.';
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
      if (width === '0') return '{SEQ:n} needs n from 1 to 9.';
      longest += Math.max(Number(width ?? 1), 3);
    } else if (!TOKENS[kind].includes(name) || width) {
      return `{${name}${width ? `:${width}` : ''}} can't be used here.`;
    } else {
      longest += SAMPLE[name].length;
    }
  }
  if (seq !== 1) return 'Include {SEQ} (or {SEQ:n}) exactly once.';
  if (longest > MAX_LENGTH[kind]) return `Codes could be longer than ${MAX_LENGTH[kind]} characters.`;
  if (longest < 2) return 'Too short.';
  return null;
}

/** Example code for the settings preview. */
export function previewCode(pattern: string, values: Record<string, string>, n = 1, now = new Date()) {
  const day = new Date(now.getTime() + 330 * 60_000).toISOString();
  const all: Record<string, string> = { BOOK: '000123', KIND: 'SH', ...values, YYYY: day.slice(0, 4), YY: day.slice(2, 4), MM: day.slice(5, 7) };
  return pattern.replace(/\{([A-Z]+)(?::(\d))?\}/g, (_, name: string, width?: string) =>
    name === 'SEQ' ? String(n).padStart(Number(width ?? 1), '0') : (all[name] ?? ''),
  );
}
