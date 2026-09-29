import { PDFDocument, type PDFFont, rgb, StandardFonts } from 'pdf-lib';

import { pdfText } from '../core/pdfText.js';

/** A letter ready to print: the template already filled in (docs/HRMS.md §13). */
export interface RenderedLetter {
  number: string;
  /** Date of the letter (YYYY-MM-DD). */
  issuedOn: string;
  recipientName: string;
  recipientCode: string;
  subject: string;
  /**
   * Plain text, one paragraph per line. `# Heading`, `* Label: value` (a row
   * of facts) and `- item` (a bullet) are laid out specially; blank lines are
   * ignored.
   */
  body: string;
  /** Adds an acceptance block for the employee to sign. */
  acceptance: boolean;
  signatoryName: string;
  signatoryTitle: string;
}


/** "29 September 2026". */
export const longDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/**
 * An A4 letter on the organization's letterhead: reference and date, the
 * employee, the subject, the body, a signature block and (optionally) an
 * acceptance block. A preview carries a PREVIEW mark on every page.
 */
export async function letterPdf(letter: RenderedLetter, context: { orgName: string; branchLines: string[]; preview: boolean }): Promise<Uint8Array> {
  const o = Object.fromEntries(Object.entries(letter).map(([k, v]) => [k, typeof v === 'string' ? pdfText(v) : v])) as unknown as RenderedLetter;
  const ctx = { ...context, orgName: pdfText(context.orgName) || 'Stories', branchLines: context.branchLines.map(pdfText) };
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${o.subject} ${o.number}`);
  pdf.setProducer('Stories');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.12);
  const muted = rgb(0.42, 0.42, 0.42);
  const left = 56;
  const right = 539;
  const width = right - left;
  const bottom = 72;

  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const stamp = () => {
    if (ctx.preview) page.drawText('PREVIEW - not released', { x: right - bold.widthOfTextAtSize('PREVIEW - not released', 10), y: 812, size: 10, font: bold, color: rgb(0.7, 0.2, 0.1) });
  };
  stamp();
  const room = (h: number) => {
    if (y - h >= bottom) return;
    page = pdf.addPage([595.28, 841.89]);
    stamp();
    y = 790;
  };
  const text = (s: string, x: number, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; alignRight?: boolean } = {}) => {
    const size = opts.size ?? 10.5;
    const f = opts.f ?? font;
    page.drawText(s, { x: opts.alignRight ? x - f.widthOfTextAtSize(s, size) : x, y, size, font: f, color: opts.color ?? ink });
  };
  /** Splits text into lines that fit `w`. */
  const wrap = (s: string, w: number, f: PDFFont, size: number) => {
    const lines: string[] = [];
    let line = '';
    for (const word of s.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > w && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const para = (s: string, opts: { f?: PDFFont; gap?: number; indent?: number; bullet?: boolean } = {}) => {
    const size = 10;
    const f = opts.f ?? font;
    const lead = size * 1.4;
    const indent = opts.indent ?? 0;
    wrap(s, width - indent, f, size).forEach((line, i) => {
      room(lead);
      if (opts.bullet && i === 0) page.drawText('-', { x: left + indent - 10, y, size, font: f, color: ink });
      page.drawText(line, { x: left + indent, y, size, font: f, color: ink });
      y -= lead;
    });
    y -= opts.gap ?? 7;
  };

  // Letterhead
  text(ctx.orgName, left, { size: 17, f: bold });
  y -= 15;
  for (const l of ctx.branchLines) {
    text(l, left, { size: 9, color: muted });
    y -= 12;
  }
  y -= 4;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.8, color: rgb(0.8, 0.8, 0.8) });
  y -= 24;

  text(`Ref: ${o.number}`, left, { size: 9.5, color: muted });
  text(longDate(o.issuedOn), right, { size: 9.5, color: muted, alignRight: true });
  y -= 22;
  text(o.recipientName, left, { f: bold });
  y -= 14;
  text(`Employee ID ${o.recipientCode}`, left, { size: 9.5, color: muted });
  y -= 22;
  for (const line of wrap(`Subject: ${o.subject}`, width, bold, 11.5)) {
    text(line, left, { f: bold, size: 11.5 });
    y -= 16;
  }
  y -= 8;

  let inFacts = false;
  let inList = false;
  for (const raw of o.body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (inList && !line.startsWith('- ')) y -= 4;
    inList = line.startsWith('- ');
    const fact = /^\*\s+([^:]+):\s*(.*)$/.exec(line);
    if (fact) {
      if (!inFacts) y -= 2;
      inFacts = true;
      const values = wrap(fact[2], width - 170, font, 10);
      room(values.length * 14 + 2);
      text(fact[1].trim(), left + 12, { size: 10, color: muted });
      values.forEach((v, i) => {
        if (i) y -= 14;
        text(v, left + 170, { size: 10 });
      });
      y -= 16;
      continue;
    }
    if (inFacts) y -= 4;
    inFacts = false;
    if (line.startsWith('# ')) {
      room(40);
      y -= 4;
      para(line.slice(2), { f: bold, gap: 4 });
    } else if (line.startsWith('- ')) para(line.slice(2), { indent: 14, bullet: true, gap: 3 });
    else para(line);
  }

  y -= 9;
  room(o.acceptance ? 140 : 80);
  text(`For ${ctx.orgName}`, left);
  y -= 36;
  text(o.signatoryName, left, { f: bold });
  y -= 14;
  text(o.signatoryTitle, left, { size: 9.5, color: muted });

  if (o.acceptance) {
    y -= 30;
    text('Acceptance', left, { f: bold });
    y -= 16;
    para(`I, ${o.recipientName}, accept the terms of this letter.`);
    y -= 18;
    text('Signature: ______________________', left, { size: 10 });
    text('Date: ______________', right, { size: 10, alignRight: true });
  }

  for (const [i, p] of pdf.getPages().entries()) {
    const note = `${o.number} · page ${i + 1} of ${pdf.getPageCount()} · computer-generated letter issued through Stories`;
    p.drawText(note, { x: left, y: 40, size: 7.5, font, color: muted });
  }
  return pdf.save();
}
