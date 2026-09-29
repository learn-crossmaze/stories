/**
 * Standard PDF fonts only carry Latin-1: typographic quotes and dashes become
 * plain ones, anything else (another script, the rupee sign, emoji) '?'.
 * Without this pdf-lib refuses the whole document.
 */
export const pdfText = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/₹/g, 'Rs.').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '?');
