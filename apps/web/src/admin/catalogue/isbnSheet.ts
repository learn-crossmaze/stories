// Turns the rows of an order spreadsheet into the list Receive books takes: ISBN, how many copies, and the price per
// copy when the sheet has one. Columns are found by their heading (ISBN; Qty / Quantity / Copies; Price / MRP /
// Rate / Cost), or, with no headings, the column holding the most ISBNs is used.
import { normalizeIsbn } from '../../shared/isbn';

export interface SheetItem {
  isbn: string;
  quantity: number;
  /** Price per copy in rupees, as written (blank: the delivery's price). */
  price: string;
}

/** The most copies one row takes (as on the page). */
export const SHEET_MAX_QUANTITY = 50;

const ISBN_HEAD = /isbn/i;
const QTY_HEAD = /^(qty|quantity|copies|no\.? of copies|nos\.?|count|units?)$/i;
const PRICE_HEAD = /(price|mrp|rate|cost)/i;

/** Excel can show a 13-digit number as 9.78014E+12; this only helps when the digits survived. */
const cleanIsbn = (cell: string) => normalizeIsbn(cell.replace(/\.0+$/, '').replace(/[\s'"]/g, ''));

export function parseIsbnSheet(rows: string[][]): { items: SheetItem[]; skipped: number } {
  const headerAt = rows.slice(0, 10).findIndex((r) => r.some((c) => ISBN_HEAD.test(c)));
  let isbnCol: number;
  let qtyCol = -1;
  let priceCol = -1;
  let body: string[][];
  if (headerAt >= 0) {
    const head = rows[headerAt];
    isbnCol = head.findIndex((c) => ISBN_HEAD.test(c));
    qtyCol = head.findIndex((c) => QTY_HEAD.test(c.trim()));
    priceCol = head.findIndex((c, i) => i !== isbnCol && PRICE_HEAD.test(c));
    body = rows.slice(headerAt + 1);
  } else {
    const width = Math.max(0, ...rows.map((r) => r.length));
    const hits = Array.from({ length: width }, (_, i) => rows.filter((r) => cleanIsbn(r[i] ?? '')).length);
    isbnCol = hits.indexOf(Math.max(0, ...hits));
    body = rows;
  }
  const byIsbn = new Map<string, SheetItem>();
  let skipped = 0;
  for (const r of body) {
    const cell = r[isbnCol] ?? '';
    if (!r.some(Boolean)) continue;
    const isbn = cleanIsbn(cell);
    if (!isbn) {
      skipped++;
      continue;
    }
    const n = qtyCol >= 0 ? Math.floor(Number((r[qtyCol] ?? '').replace(/,/g, ''))) : 1;
    const quantity = Number.isFinite(n) && n > 0 ? n : 1;
    const priceNumber = priceCol >= 0 ? Number((r[priceCol] ?? '').replace(/[₹,\s]|rs\.?/gi, '')) : NaN;
    const price = Number.isFinite(priceNumber) && priceNumber >= 0 && (r[priceCol] ?? '').trim() ? String(priceNumber) : '';
    const had = byIsbn.get(isbn);
    if (had) had.quantity += quantity;
    else byIsbn.set(isbn, { isbn, quantity, price });
  }
  const items = [...byIsbn.values()].map((i) => ({ ...i, quantity: Math.min(SHEET_MAX_QUANTITY, i.quantity) }));
  return { items, skipped };
}

/** The template staff download: the headings, and one example row. */
export const SHEET_TEMPLATE = 'ISBN,Quantity,Price\n9780140328721,3,299\n';
