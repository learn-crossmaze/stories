import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

import { pdfText } from '../core/pdfText.js';
import { inWords, rupees } from './payrollRules.js';

/**
 * A one-page A4 payslip. Standard PDF fonts have no rupee sign, so amounts
 * read "Rs.". Draft payslips (not yet approved) carry a DRAFT mark.
 */
export async function payslipPdf(slip: Record<string, unknown>, ctx: { orgName: string; branchName: string; draft: boolean }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Payslip ${String(slip.employeeCode)} ${String(slip.month)}`);
  pdf.setProducer('Stories');
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.12);
  const muted = rgb(0.42, 0.42, 0.42);
  const line = rgb(0.82, 0.82, 0.82);
  const left = 48;
  const right = 547;
  let y = 790;

  const text = (s: string, x: number, yy: number, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; alignRight?: boolean } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const safe = pdfText(s);
    const w = f.widthOfTextAtSize(safe, size);
    page.drawText(safe, { x: opts.alignRight ? x - w : x, y: yy, size, font: f, color: opts.color ?? ink });
  };
  const rule = (yy: number) => page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness: 0.7, color: line });

  const [yr, mo] = String(slip.month).split('-').map(Number);
  const monthName = new Date(Date.UTC(yr, mo - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  text(ctx.orgName || 'Stories', left, y, { size: 16, f: bold });
  text(ctx.branchName, left, y - 16, { color: muted });
  text(`Payslip for ${monthName}`, right, y, { size: 13, f: bold, alignRight: true });
  if (ctx.draft) text('DRAFT - not yet approved', right, y - 16, { f: bold, color: rgb(0.7, 0.2, 0.1), alignRight: true });
  y -= 34;
  rule(y);
  y -= 18;

  const days = (slip.days ?? {}) as Record<string, number>;
  const bank = slip.bank as { bankName?: string | null; last4?: string | null } | null;
  const facts: [string, string][] = [
    ['Employee', `${String(slip.employeeName)} (${String(slip.employeeCode)})`],
    ['Designation', String(slip.designation ?? '-')],
    ['Department', String(slip.department ?? '-')],
    ['Date of joining', String(slip.joiningDate ?? '-')],
    ['PAN', String(slip.pan ?? '-')],
    ['UAN', String(slip.uan ?? '-')],
    ['Bank account', bank?.last4 ? `${bank.bankName ?? ''} xxxx${bank.last4}` : '-'],
    ['Days paid', `${days.payable ?? 0} of ${days.inMonth ?? 0} (leave ${days.leave ?? 0}, absent ${days.absent ?? 0})`],
  ];
  facts.forEach(([k, v], i) => {
    const col = i % 2;
    const x = col ? 310 : left;
    const yy = y - Math.floor(i / 2) * 16;
    text(k, x, yy, { size: 9, color: muted });
    text(v, x + 88, yy, { size: 9 });
  });
  y -= Math.ceil(facts.length / 2) * 16 + 10;
  rule(y);
  y -= 20;

  type Row = [string, number];
  const earnings: Row[] = [
    ...((slip.earnings as { name: string; amount: number }[] | undefined) ?? []).map((e): Row => [e.name, e.amount]),
    ...((slip.otherEarnings as { name: string; amount: number }[] | undefined) ?? []).map((e): Row => [e.name, e.amount]),
  ];
  const deductions: Row[] = [
    ['Provident fund', Number(slip.pfEmployee ?? 0)],
    ['ESI', Number(slip.esiEmployee ?? 0)],
    ['Professional tax', Number(slip.pt ?? 0)],
    ['Income tax (TDS)', Number(slip.tds ?? 0)],
    ...((slip.otherDeductions as { name: string; amount: number }[] | undefined) ?? []).map((e): Row => [e.name, e.amount]),
  ].filter(([, n]) => n) as Row[];

  const table = (p: PDFPage, title: string, rows: Row[], x: number, width: number, total: [string, number]) => {
    let yy = y;
    text(title, x, yy, { f: bold });
    text('Amount', x + width, yy, { f: bold, alignRight: true });
    yy -= 6;
    p.drawLine({ start: { x, y: yy }, end: { x: x + width, y: yy }, thickness: 0.7, color: line });
    yy -= 14;
    for (const [name, amount] of rows) {
      text(name, x, yy, { size: 9.5 });
      text(rupees(amount), x + width, yy, { size: 9.5, alignRight: true });
      yy -= 15;
    }
    return (bottom: number) => {
      p.drawLine({ start: { x, y: bottom + 12 }, end: { x: x + width, y: bottom + 12 }, thickness: 0.7, color: line });
      text(total[0], x, bottom, { f: bold });
      text(rupees(total[1]), x + width, bottom, { f: bold, alignRight: true });
      return yy;
    };
  };
  const finishEarnings = table(page, 'Earnings', earnings, left, 230, ['Gross earnings', Number(slip.gross ?? 0)]);
  const finishDeductions = table(page, 'Deductions', deductions.length ? deductions : [['None', 0]], 317, 230, ['Total deductions', Number(slip.deductions ?? 0)]);
  const rows = Math.max(earnings.length, Math.max(1, deductions.length));
  const bottom = y - 20 - rows * 15 - 6;
  finishEarnings(bottom);
  finishDeductions(bottom);
  y = bottom - 30;

  page.drawRectangle({ x: left, y: y - 34, width: right - left, height: 44, color: rgb(0.95, 0.93, 0.9) });
  text('Net pay', left + 12, y - 8, { f: bold, size: 12 });
  text(rupees(Number(slip.net ?? 0)), right - 12, y - 8, { f: bold, size: 12, alignRight: true });
  text(`Rupees ${inWords(Number(slip.net ?? 0))} only`, left + 12, y - 24, { size: 9, color: muted });
  y -= 60;

  const employer = (
    [
      ['Employer PF (pension ' + rupees(Number(slip.eps ?? 0)) + ')', Number(slip.pfEmployer ?? 0)],
      ['Employer ESI', Number(slip.esiEmployer ?? 0)],
    ] as [string, number][]
  ).filter(([, v]) => v > 0);
  if (employer.length) text('Paid by the employer (not deducted)', left, y, { size: 9, f: bold, color: muted });
  y -= 14;
  for (const [k, v] of employer) {
    text(k, left, y, { size: 9, color: muted });
    text(rupees(v), left + 230, y, { size: 9, color: muted, alignRight: true });
    y -= 13;
  }

  text('This is a computer-generated payslip and needs no signature.', left, 60, { size: 8, color: muted });
  return pdf.save();
}
