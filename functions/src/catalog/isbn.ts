/**
 * ISBN handling. Stored form is always ISBN-13 digits only (no hyphens).
 * ISBN-10 input is converted (978 prefix, recomputed check digit).
 */
export function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

/** Returns the canonical ISBN-13, or null if the input is not a valid ISBN-10/13. */
export function normalizeIsbn(input: string): string | null {
  const s = input.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(s)) {
    if (!s.startsWith('978') && !s.startsWith('979')) return null;
    return isbn13CheckDigit(s.slice(0, 12)) === s[12] ? s : null;
  }
  if (s.length === 10 && isValidIsbn10(s)) {
    const base = '978' + s.slice(0, 9);
    return base + isbn13CheckDigit(base);
  }
  return null;
}
