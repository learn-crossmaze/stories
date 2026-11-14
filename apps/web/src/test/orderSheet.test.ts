import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { parseIsbnSheet } from '../admin/catalogue/isbnSheet';
import { parseCsv, readSpreadsheet, SpreadsheetError } from '../shared/spreadsheet';

// A minimal .xlsx (a zip of XML files), as Excel writes it: shared strings plus numbers.
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = deflateRawSync(Buffer.from(body));
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, body.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, body.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...locals, ...centrals, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of all) out.set(a, at), (at += a.length);
  return out;
}

const xlsx = () =>
  zip({
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Order" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Title</t></si><si><t>ISBN</t></si><si><t>Qty</t></si><si><t>MRP</t></si><si><t>Matilda</t></si><si><t>978-0-14-032872-1</t></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2"><v>3</v></c><c r="D2"><v>299</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>The Hobbit</t></is></c><c r="B3"><v>9780261102217</v></c><c r="C3"><v>2</v></c></row>' +
      '<row r="4"><c r="A4" t="inlineStr"><is><t>No ISBN here</t></is></c><c r="C4"><v>1</v></c></row>' +
      '</sheetData></worksheet>',
  });
const file = (bytes: Uint8Array | string, name: string) => new File([bytes as BlobPart], name);

describe('order spreadsheets', () => {
  it('reads an Excel file: finds the ISBN, quantity and price columns by their headings', async () => {
    const rows = await readSpreadsheet(file(xlsx(), 'order.xlsx'));
    expect(rows[1]).toEqual(['Matilda', '978-0-14-032872-1', '3', '299']);
    const { items, skipped } = parseIsbnSheet(rows);
    expect(items).toEqual([
      { isbn: '9780140328721', quantity: 3, price: '299' },
      { isbn: '9780261102217', quantity: 2, price: '' },
    ]);
    expect(skipped).toBe(1);
  });

  it('reads a CSV, adds up repeated ISBNs and keeps to 50 copies a row', async () => {
    const csv = 'ISBN;Copies;Price\n9780140328721;30;"₹1,299"\n978-0140328721;30;\n0-14-032872-X;1;\n';
    const { items } = parseIsbnSheet(await readSpreadsheet(file(csv, 'order.csv')));
    // The ten-digit ISBN is the same book as the thirteen-digit one.
    expect(items).toEqual([{ isbn: '9780140328721', quantity: 50, price: '1299' }]);
  });

  it('takes a plain list with no headings from the column holding the ISBNs', () => {
    const { items } = parseIsbnSheet(parseCsv('Matilda,9780140328721\nThe Hobbit,9780261102217\n'));
    expect(items.map((i) => i.isbn)).toEqual(['9780140328721', '9780261102217']);
    expect(items.every((i) => i.quantity === 1)).toBe(true);
  });

  it('turns away an old .xls file with a reason', async () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    await expect(readSpreadsheet(file(xls, 'order.xls'))).rejects.toBeInstanceOf(SpreadsheetError);
  });
});
