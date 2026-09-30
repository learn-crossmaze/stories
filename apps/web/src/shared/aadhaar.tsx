import { useState } from 'react';

import { toApiError } from '../data/api';

// Aadhaar numbers (functions/src/core/aadhaar.ts): checked here as people type,
// stored in full only where no page can read it, shown as the last four digits.

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export const cleanAadhaar = (v: string) => v.replace(/[\s-]/g, '');

/** 12 digits, not starting with 0 or 1, with a valid Verhoeff check digit. */
export function isAadhaar(v: string): boolean {
  const n = cleanAadhaar(v);
  if (!/^[2-9]\d{11}$/.test(n)) return false;
  let c = 0;
  [...n].reverse().forEach((ch, i) => {
    c = D[c][P[i % 8][Number(ch)]];
  });
  return c === 0;
}

/** Why a typed number can't be saved ('' = fine, including left empty). */
export const aadhaarError = (v: string) => (!v.trim() || isAadhaar(v) ? '' : 'Enter the 12-digit Aadhaar number (check for a typo).');

export const maskAadhaar = (last4: string) => `XXXX XXXX ${last4}`;
export const formatAadhaar = (n: string) => n.replace(/(\d{4})(?=\d)/g, '$1 ');

/** Hint under an Aadhaar field: what happens to a number already on file. */
export const aadhaarHint = (last4?: string | null) =>
  last4 ? `On file: ${maskAadhaar(last4)}. Leave empty to keep it, or type a new number to replace it.` : 'Only the last four digits are shown after saving.';

/** The masked number, with a Show button for people allowed to see it in full (the server records each look). */
export function AadhaarValue({ last4, reveal }: { last4?: string | null; reveal?: () => Promise<string> }) {
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!last4) return null;
  return (
    <span className="aadhaar-value">
      <span className="mono">{full ? formatAadhaar(full) : maskAadhaar(last4)}</span>
      {reveal && (
        <button
          type="button"
          className="btn btn-text btn-inline"
          disabled={busy}
          title="Showing the full number is recorded in the audit log."
          onClick={async () => {
            if (full) return setFull(null);
            setBusy(true);
            setError(null);
            try {
              setFull(await reveal());
            } catch (e) {
              setError(toApiError(e).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {full ? 'Hide' : 'Show'}
        </button>
      )}
      {error && <span className="field-error"> {error}</span>}
    </span>
  );
}
