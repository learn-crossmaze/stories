/**
 * IFSC checks and lookup. The format is 4 letters (bank), a zero, then 6 letters
 * or digits (branch). Details come from Razorpay's free public IFSC directory
 * (https://ifsc.razorpay.com), called straight from the browser; it needs no key.
 */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const cleanIfsc = (input: string) => input.replace(/\s/g, '').toUpperCase();
export const isIfsc = (input: string) => IFSC_PATTERN.test(cleanIfsc(input));

export interface IfscDetails {
  ifsc: string;
  bank: string;
  branch: string;
  city: string;
  state: string;
}

export type IfscLookup = { found: true; details: IfscDetails } | { found: false } | { found: null };

const cache = new Map<string, IfscLookup>();
const IFSC_API = 'https://ifsc.razorpay.com/';

/** Looks up an IFSC: found, not found, or `found: null` when the directory can't be reached. */
export async function lookupIfsc(input: string, signal?: AbortSignal): Promise<IfscLookup> {
  const code = cleanIfsc(input);
  if (!IFSC_PATTERN.test(code)) return { found: false };
  const hit = cache.get(code);
  if (hit) return hit;
  try {
    const res = await fetch(IFSC_API + code, { signal });
    if (res.status === 404) return remember(code, { found: false });
    if (!res.ok) return { found: null };
    const d = (await res.json()) as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string).trim() : '');
    if (!s('BANK')) return { found: null };
    return remember(code, { found: true, details: { ifsc: code, bank: s('BANK'), branch: s('BRANCH'), city: s('CITY') || s('DISTRICT'), state: s('STATE') } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return { found: null };
  }
}

function remember(code: string, r: IfscLookup) {
  cache.set(code, r);
  return r;
}

/** "Koramangala, Bengaluru, Karnataka" without repeats or blanks. */
export const branchLine = (d: IfscDetails) =>
  [d.branch, d.city, d.state].filter((x, i, a) => x && a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(', ');
