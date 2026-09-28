import QRCode from 'qrcode';
import { useState } from 'react';

import { QrCode } from './QrCode';
import { t } from '../strings';

/**
 * Member ID card (credit-card size, 85.6 × 54 mm). The QR code holds the member
 * code, so the desk's "Find member" box (scanner or camera) opens the member.
 * Shared by the staff console (print / download) and the member app (download).
 */
export interface IdCardInfo {
  orgName: string;
  branchName: string;
  branchPhone?: string | null;
  fullName: string;
  code: string;
  /** End of the paid term, if any ("Valid until"). */
  validUntil?: string | null;
  guardianName?: string | null;
}

const INK = '#b4502b';
const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });
const shortDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateFmt.format(d);
};

export function IdCard({ info }: { info: IdCardInfo }) {
  const valid = shortDate(info.validUntil);
  return (
    <div className="id-card" role="img" aria-label={t.idCardAlt(info.fullName, info.code)}>
      <div className="id-card-band">
        <span className="id-card-brand">Stories</span>
        <span className="id-card-org">{info.orgName}</span>
      </div>
      <div className="id-card-body">
        <div className="id-card-text">
          <span className="id-card-kicker">{t.idCardMember}</span>
          <span className="id-card-name">{info.fullName}</span>
          <span className="id-card-code">{info.code}</span>
          <span className="id-card-meta">{info.branchName}</span>
          {info.guardianName && <span className="id-card-meta">{t.idCardGuardian(info.guardianName)}</span>}
          {valid && <span className="id-card-meta">{t.idCardValid(valid)}</span>}
        </div>
        <QrCode value={info.code} className="id-card-qr" />
      </div>
      <div className="id-card-foot">{info.branchPhone ? t.idCardFootPhone(info.branchPhone) : t.idCardFoot}</div>
    </div>
  );
}

/** The card with Download (PNG) and Print buttons. */
export function IdCardPanel({ info }: { info: IdCardInfo }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="id-card-panel">
      <div className="id-card-print">
        <IdCard info={info} />
      </div>
      <div className="row no-print">
        <button
          type="button"
          className="btn btn-filled"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await downloadIdCard(info);
            } catch (e) {
              console.error(e);
              setError(t.errorGeneric);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t.loading : t.idCardDownload}
        </button>
        <button type="button" className="btn btn-outlined" onClick={printIdCard}>
          {t.idCardPrint}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Prints just the card (the rest of the page is hidden by the `printing-card` print styles). */
export function printIdCard() {
  document.body.classList.add('printing-card');
  const done = () => {
    document.body.classList.remove('printing-card');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/** Draws the card at 300 dpi (1011 × 638 px) and saves it as a PNG. */
export async function downloadIdCard(info: IdCardInfo) {
  const W = 1011;
  const H = 638;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  await Promise.all(['600 60px Fraunces', '400 30px Inter', '600 30px Inter'].map((f) => document.fonts?.load(f).catch(() => undefined)));

  const r = 36;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, r);
  ctx.fillStyle = '#fbf7f0';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, 130);
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = '600 58px Fraunces, Georgia, serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Stories', 48, 66);
  ctx.font = '500 28px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(fit(ctx, info.orgName, 520), W - 48, 68);
  ctx.textAlign = 'left';

  const qrSize = 330;
  const qrX = W - qrSize - 40;
  const qrY = 160;
  const qr = await loadImage(await QRCode.toDataURL(info.code, { margin: 1, width: qrSize, errorCorrectionLevel: 'M', color: { dark: '#1e2a2f', light: '#ffffff' } }));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20);
  ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);

  const textW = qrX - 48 - 40;
  let y = 190;
  ctx.fillStyle = '#4a565b';
  ctx.font = '600 24px Inter, system-ui, sans-serif';
  ctx.fillText(t.idCardMember.toUpperCase(), 48, y);
  y += 62;
  ctx.fillStyle = '#1e2a2f';
  ctx.font = '600 52px Fraunces, Georgia, serif';
  for (const line of wrap(ctx, info.fullName, textW, 2)) {
    ctx.fillText(line, 48, y);
    y += 60;
  }
  ctx.fillStyle = INK;
  ctx.font = '600 40px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(info.code, 48, y + 4);
  y += 62;
  ctx.fillStyle = '#4a565b';
  ctx.font = '400 28px Inter, system-ui, sans-serif';
  const valid = shortDate(info.validUntil);
  for (const line of [info.branchName, info.guardianName ? t.idCardGuardian(info.guardianName) : null, valid ? t.idCardValid(valid) : null]) {
    if (!line) continue;
    ctx.fillText(fit(ctx, line, textW), 48, y);
    y += 40;
  }

  ctx.fillStyle = '#4a565b';
  ctx.font = '400 24px Inter, system-ui, sans-serif';
  ctx.fillText(fit(ctx, info.branchPhone ? t.idCardFootPhone(info.branchPhone) : t.idCardFoot, W - 96), 48, H - 40);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('could not create the image');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Stories-ID-${info.code}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Shortens text with an ellipsis to fit the width. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s}…`;
}

/** Breaks text into at most `max` lines that fit the width (the last one shortened). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > max ? [...lines.slice(0, max - 1), fit(ctx, lines.slice(max - 1).join(' '), width)] : lines.map((l) => fit(ctx, l, width));
}
