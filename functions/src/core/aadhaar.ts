import { createHash } from 'node:crypto';

import { z } from 'zod';

// Aadhaar numbers (UIDAI): 12 digits, never starting with 0 or 1, the last
// digit a Verhoeff check digit. The full number is personal data the Aadhaar
// rules say to keep out of general view: it is stored only where no client can
// read it (a functions-only `private/aadhaar` document), pages show the last
// four digits, and revealing it is audited.

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

/** True for a 12-digit Aadhaar number with a valid Verhoeff check digit. */
export function isAadhaar(n: string): boolean {
  if (!/^[2-9]\d{11}$/.test(n)) return false;
  let c = 0;
  [...n].reverse().forEach((ch, i) => {
    c = D[c][P[i % 8][Number(ch)]];
  });
  return c === 0;
}

/** Optional Aadhaar input: spaces and dashes ignored; '' leaves the stored number as it is. */
export const aadhaarInput = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => v === '' || isAadhaar(v), 'must be a valid 12-digit Aadhaar number')
  .default('');

/** One-way key for the organization's duplicate check (the number itself is not kept in the index). */
export const aadhaarKey = (orgId: string, n: string) => createHash('sha256').update(`${orgId}:${n}`).digest('hex');
