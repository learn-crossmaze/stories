import { PDFDocument, type PDFFont, rgb, StandardFonts } from 'pdf-lib';

import { inWords, rupees } from './payrollRules.js';

/** What an offer letter says (docs/HRMS.md §12). */
export interface OfferLetter {
  number: string;
  /** Date of the letter (YYYY-MM-DD). */
  issuedOn: string;
  candidateName: string;
  candidateCode: string;
  designation: string;
  department: string | null;
  employmentType: string;
  joiningDate: string;
  annualCtc: number;
  probationMonths: number;
  noticeDays: number;
  acceptBy: string;
  reportingTo: string | null;
  workLocation: string;
  terms: string;
  signatoryName: string;
  signatoryTitle: string;
}

/** Standard PDF fonts only carry Latin-1: anything else (another script, emoji) becomes '?'. */
const latin1 = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '?');

const EMPLOYMENT: Record<string, string> = { FULL_TIME: 'full-time', PART_TIME: 'part-time', CONTRACT: 'contract', INTERN: 'internship' };

/** "29 September 2026". */
export const longDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/**
 * An A4 offer letter. A preview carries a PREVIEW mark on every page. Standard
 * PDF fonts have no rupee sign, so amounts read "Rs.".
 */
export async function offerLetterPdf(offer: OfferLetter, context: { orgName: string; branchLines: string[]; preview: boolean }): Promise<Uint8Array> {
  const o = Object.fromEntries(Object.entries(offer).map(([k, v]) => [k, typeof v === 'string' ? latin1(v) : v])) as unknown as OfferLetter;
  const ctx = { ...context, orgName: latin1(context.orgName), branchLines: context.branchLines.map(latin1) };
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Offer letter ${o.number}`);
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
  /** Wraps a paragraph to the page width, starting new pages as needed. */
  const para = (s: string, opts: { size?: number; f?: PDFFont; gap?: number; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const lead = size * 1.4;
    const x = left + (opts.indent ?? 0);
    for (const raw of s.split('\n')) {
      const words = raw.split(/\s+/).filter(Boolean);
      let line = '';
      const flush = () => {
        room(lead);
        page.drawText(line, { x, y, size, font: f, color: ink });
        y -= lead;
        line = '';
      };
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(next, size) > width - (opts.indent ?? 0) && line) {
          flush();
          line = w;
        } else line = next;
      }
      if (line) flush();
      else if (!words.length) y -= lead / 2;
    }
    y -= opts.gap ?? 7;
  };

  // Letterhead
  text(ctx.orgName || 'Stories', left, { size: 17, f: bold });
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
  text(o.candidateName, left, { f: bold });
  y -= 14;
  text(`Employee ID ${o.candidateCode}`, left, { size: 9.5, color: muted });
  y -= 22;
  text('Subject: Offer of employment', left, { f: bold, size: 11.5 });
  y -= 24;

  const first = o.candidateName.split(/\s+/)[0];
  para(`Dear ${first},`);
  para(
    `We are pleased to offer you the position of ${o.designation}${o.department ? ` in the ${o.department} department` : ''} at ${ctx.orgName || 'Stories'}, ` +
      `on a ${EMPLOYMENT[o.employmentType] ?? 'full-time'} basis. The terms of this offer are set out below.`,
  );

  const facts: [string, string][] = [
    ['Position', o.designation],
    ...(o.department ? ([['Department', o.department]] as [string, string][]) : []),
    ['Place of work', o.workLocation],
    ['Date of joining', longDate(o.joiningDate)],
    ...(o.reportingTo ? ([['Reporting to', o.reportingTo]] as [string, string][]) : []),
    ['Annual cost to company', `${rupees(o.annualCtc)} (Rupees ${inWords(o.annualCtc)} only)`],
    ['Probation', o.probationMonths ? `${o.probationMonths} month${o.probationMonths === 1 ? '' : 's'}` : 'None'],
    ['Notice period', o.noticeDays ? `${o.noticeDays} days` : 'None'],
  ];
  room(facts.length * 18 + 16);
  y -= 4;
  for (const [k, v] of facts) {
    text(k, left + 12, { size: 10, color: muted });
    // Long values (the amount in words) wrap under themselves.
    const words = v.split(' ');
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, 10) > width - 170 && line) {
        text(line, left + 170, { size: 10 });
        y -= 14;
        line = w;
      } else line = next;
    }
    text(line, left + 170, { size: 10 });
    y -= 16;
  }
  y -= 4;

  para(
    'Your salary will be paid monthly, after deductions required by law (provident fund, ESI, professional tax and income tax, where they apply). ' +
      'The break-up of your salary will be shared with you on joining.',
  );
  if (o.probationMonths) para(`You will be on probation for the first ${o.probationMonths} month${o.probationMonths === 1 ? '' : 's'}. On confirmation, either side may end the employment by giving ${o.noticeDays || 'no'} days' notice.`);
  para('This offer depends on the documents you share with us being genuine, and on your joining on the date above.');
  if (o.terms.trim()) {
    room(40);
    text('Other terms', left, { f: bold });
    y -= 18;
    para(o.terms.trim());
  }
  para(`Please accept this offer by signing a copy of this letter and returning it to us by ${longDate(o.acceptBy)}. After that date the offer lapses.`);
  para('We look forward to welcoming you to the team.', { gap: 16 });

  room(140);
  text(`For ${ctx.orgName || 'Stories'}`, left);
  y -= 36;
  text(o.signatoryName, left, { f: bold });
  y -= 14;
  text(o.signatoryTitle, left, { size: 9.5, color: muted });
  y -= 30;

  text('Acceptance', left, { f: bold });
  y -= 16;
  para(`I, ${o.candidateName}, accept this offer on the terms above.`, { size: 10 });
  y -= 18;
  text('Signature: ______________________', left, { size: 10 });
  text('Date: ______________', right, { size: 10, alignRight: true });

  for (const [i, p] of pdf.getPages().entries()) {
    const note = `${o.number} · page ${i + 1} of ${pdf.getPageCount()} · computer-generated letter issued through Stories`;
    p.drawText(note, { x: left, y: 40, size: 7.5, font, color: muted });
  }
  return pdf.save();
}
