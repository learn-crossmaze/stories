import { BarcodeFormat, QRCodeWriter } from '@zxing/library';
import JsBarcode from 'jsbarcode';
import { describe, expect, it } from 'vitest';

import { createDecoder, rotateSmall } from '../admin/components/barcode';

type Matrix = { getWidth(): number; getHeight(): number; get(x: number, y: number): boolean };

/** A webcam-like frame: a white label with the code on a grey desk, softened by a box blur. */
function frame(m: Matrix, scale: number, opts: { blur?: number; tilt?: number; w?: number; h?: number } = {}) {
  const w = opts.w ?? 640;
  const h = opts.h ?? 480;
  const g = new Uint8ClampedArray(w * h).fill(110);
  const cw = m.getWidth() * scale;
  const ch = Math.min(m.getHeight() * scale, h - 80);
  const ox = Math.round((w - cw) / 2);
  const oy = Math.round((h - ch) / 2);
  for (let y = oy - 30; y < oy + ch + 30; y++) for (let x = ox - 30; x < ox + cw + 30; x++) g[y * w + x] = 235;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) if (m.get(Math.floor(x / scale), Math.min(m.getHeight() - 1, Math.floor((y / ch) * m.getHeight())))) g[(oy + y) * w + ox + x] = 40;
  let out: Uint8ClampedArray = g;
  for (let r = opts.blur ?? 0; r > 0; r--) {
    const b = new Uint8ClampedArray(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += out[(y + dy) * w + x + dx];
        b[y * w + x] = s / 9;
      }
    out = b;
  }
  if (opts.tilt) out = rotateSmall(out, w, h, opts.tilt, 110);
  return { gray: out, w, h };
}

/** 1-D bars as a book's ISBN or an older printed label has them (jsbarcode), with a quiet zone either side. */
function bars(text: string, format: string): Matrix {
  const out: { encodings?: { data: string }[] } = {};
  JsBarcode(out, text, { format });
  const bits = '0'.repeat(12) + out.encodings!.map((e) => e.data).join('') + '0'.repeat(12);
  return { getWidth: () => bits.length, getHeight: () => 60, get: (x) => bits[x] === '1' };
}

const decode = createDecoder();
const read = (f: { gray: Uint8ClampedArray; w: number; h: number }) => decode(f.gray, f.w, f.h, 'quick') ?? decode(f.gray, f.w, f.h, 'thorough') ?? decode(f.gray, f.w, f.h, 'thorough');

describe('camera barcode decoder', () => {
  it('reads a blurred Code 128 copy label on a grey background', () => {
    const m = bars('COPY-000001-02', 'CODE128');
    expect(read(frame(m, 3, { blur: 2 }))?.text).toBe('COPY-000001-02');
  });

  it('reads a slightly tilted ISBN', () => {
    const m = bars('9780143127741', 'EAN13');
    expect(read(frame(m, 4, { blur: 1, tilt: 4 }))?.text).toBe('9780143127741');
  });

  it('reads a small, blurred, rotated QR label', () => {
    const m = new QRCodeWriter().encode('COPY-000001-02', BarcodeFormat.QR_CODE, 0, 0, new Map());
    expect(read(frame(m, 4, { blur: 1, tilt: 25 }))?.text).toBe('COPY-000001-02');
  });

  it('reports nothing for an empty frame', () => {
    const g = new Uint8ClampedArray(640 * 480).fill(120);
    expect(decode(g, 640, 480, 'quick')).toBeNull();
    expect(decode(g, 640, 480, 'thorough')).toBeNull();
  });
});
