// Reads the first sheet of an Excel (.xlsx) or CSV file into rows of text, in the browser, with no library: an
// .xlsx file is a zip of XML files, unpacked here with the browser's own DecompressionStream. Enough for a list of
// ISBNs from a publisher's or supplier's order (text, numbers, shared strings); formulas are read as their last
// saved value. Older .xls files (Excel 97-2003) are not read: save them as .xlsx or CSV first.

export class SpreadsheetError extends Error {}

const text = new TextDecoder();

/** The files inside a zip, by name (only the "stored" and "deflate" methods, which is all Excel writes). */
async function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: the last 0x06054b50 within the final 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new SpreadsheetError('not a zip');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new SpreadsheetError('bad zip');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = text.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, text.decode(data));
    else if (method === 8) {
      const stream = new Response(data.slice()).body!.pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, await new Response(stream).text());
    } else throw new SpreadsheetError('unsupported zip');
  }
  return out;
}

/** "B12" → column index 1. */
const columnOf = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
  const shared = files.has('xl/sharedStrings.xml')
    ? [...parse(files.get('xl/sharedStrings.xml')!).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''))
    : [];
  // The first sheet in the workbook's own order (its file is not always sheet1.xml).
  let sheetFile = 'xl/worksheets/sheet1.xml';
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = parse(wb).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = [...parse(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetFile = 'xl/' + target.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheet = files.get(sheetFile) ?? [...files].find(([n]) => n.startsWith('xl/worksheets/'))?.[1];
  if (!sheet) throw new SpreadsheetError('no sheet');
  const rows: string[][] = [];
  for (const row of parse(sheet).getElementsByTagName('row')) {
    const cells: string[] = [];
    let next = 0;
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r');
      const col = ref ? columnOf(ref) : next;
      next = col + 1;
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      cells[col] =
        type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('') : v;
    }
    rows.push(Array.from(cells, (x) => (x ?? '').trim()));
  }
  return rows;
}

/** CSV (comma, semicolon or tab separated, quotes allowed), as Excel saves it. */
export function parseCsv(src: string): string[][] {
  const body = src.replace(/^﻿/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell.trim()), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell.trim()), rows.push(row);
  return rows.filter((r) => r.some(Boolean));
}

/** The first sheet of an .xlsx file, or a .csv / .txt file, as rows of text. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return readXlsx(bytes);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new SpreadsheetError('xls');
  return parseCsv(text.decode(bytes));
}
