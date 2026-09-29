/**
 * ISBN checks in the browser, mirroring functions/src/catalogue/isbn.ts so a
 * typo is caught before any lookup. The canonical form is ISBN-13 digits.
 */
const check13 = (first12: string) => {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
};

function valid10(s: string) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

/** The ISBN-13 for an ISBN-10 or ISBN-13 (spaces and hyphens allowed), or null if it isn't valid. */
export function normalizeIsbn(input: string): string | null {
  const s = input.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(s)) return (s.startsWith('978') || s.startsWith('979')) && check13(s.slice(0, 12)) === s[12] ? s : null;
  if (s.length === 10 && valid10(s)) {
    const base = `978${s.slice(0, 9)}`;
    return base + check13(base);
  }
  return null;
}

/** Splits pasted text (new lines, commas, spaces) into ISBN-looking pieces. */
export const splitIsbns = (text: string) =>
  text
    .split(/[\n,;\t ]+/)
    .map((x) => x.trim())
    .filter((x) => /[\dXx]{9,}/.test(x.replace(/-/g, '')));
