/**
 * Barcode decoding for camera frames (ZXing), tuned for laptop webcams: low
 * resolution, fixed focus (slightly blurry), labels held at an angle.
 *
 * Works on grayscale pixels only, so it runs in a Web Worker (barcode.worker.ts)
 * and in tests alike. Frames alternate between two modes (the scanner sends the
 * framing-guide area for quick frames and the whole picture for thorough ones):
 * - quick (~20–90 ms): QR / Data Matrix, then 1-D barcodes on a few rows;
 * - thorough (~250 ms): QR / Data Matrix harder and at twice the size (small
 *   labels), 1-D in each third of the picture, 1-D with the bar edges sharpened, turned
 *   90° for labels held upright, and straightened for strongly tilted ones.
 * 1-D rows are binarized with a local threshold (LocalRowBinarizer), which is
 * what makes blurred bars against a busy background readable.
 * GS1 DataBar (RSS) is left out: ZXing's readers for it keep pieces from
 * earlier frames and invent numbers. Callers should still accept a code only
 * after two matching reads.
 */
import {
  Binarizer,
  BarcodeFormat,
  BinaryBitmap,
  BitArray,
  BitMatrix,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  type LuminanceSource,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';

import type { Decoded, Mode } from './scan';

export type { Decoded, Mode } from './scan';

const ONE_D = [
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.CODABAR,
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF,
];

function reader(formats: BarcodeFormat[], tryHarder: boolean) {
  const r = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, formats]]);
  if (tryHarder) hints.set(DecodeHintType.TRY_HARDER, true);
  r.setHints(hints);
  return r;
}

/**
 * Row binarizer with a local threshold. ZXing's 1-D readers always binarize a
 * row with one global threshold (even HybridBinarizer only works locally for
 * 2-D codes). With a grey desk and a white label in the same row that threshold
 * lands between the two, and the blurred white gaps between bars turn black, so
 * the bars merge. Here each pixel is compared with the middle of the darkest and
 * lightest values around it (a window a few bars wide); flat areas without
 * contrast (desk, label margin) count as white.
 */
export class LocalRowBinarizer extends Binarizer {
  private readonly hybrid: HybridBinarizer;

  constructor(source: LuminanceSource) {
    super(source);
    this.hybrid = new HybridBinarizer(source);
  }

  getBlackRow(y: number, row: BitArray | null): BitArray {
    const source = this.getLuminanceSource();
    const w = source.getWidth();
    const lum = source.getRow(y, new Uint8ClampedArray(w));
    const out = row && row.getSize() >= w ? (row.clear(), row) : new BitArray(w);
    const radius = Math.max(8, Math.round(w / 60));
    // Sliding-window min and max (monotonic queues), O(width).
    const lo = new Int32Array(w);
    const hi = new Int32Array(w);
    const qMin: number[] = [];
    const qMax: number[] = [];
    let head = 0;
    let headMax = 0;
    for (let x = 0, r = 0; x < w; x++) {
      for (; r < w && r <= x + radius; r++) {
        while (qMin.length > head && lum[qMin[qMin.length - 1]] >= lum[r]) qMin.pop();
        qMin.push(r);
        while (qMax.length > headMax && lum[qMax[qMax.length - 1]] <= lum[r]) qMax.pop();
        qMax.push(r);
      }
      while (qMin[head] < x - radius) head++;
      while (qMax[headMax] < x - radius) headMax++;
      lo[x] = lum[qMin[head]];
      hi[x] = lum[qMax[headMax]];
    }
    for (let x = 0; x < w; x++) {
      if (hi[x] - lo[x] < 40) continue; // no bars here
      if (lum[x] < (lo[x] + hi[x]) >> 1) out.set(x);
    }
    return out;
  }

  getBlackMatrix(): BitMatrix {
    return this.hybrid.getBlackMatrix();
  }

  createBinarizer(source: LuminanceSource): Binarizer {
    return new LocalRowBinarizer(source);
  }
}

/** Unsharp mask across the bars (horizontal): restores edges a fixed-focus lens softened. */
export function sharpen(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const p = gray[i];
      const l1 = gray[x > 0 ? i - 1 : i];
      const r1 = gray[x < w - 1 ? i + 1 : i];
      const l2 = gray[x > 1 ? i - 2 : i];
      const r2 = gray[x < w - 2 ? i + 2 : i];
      out[i] = p + 1.5 * (2 * p - l1 - r1) + 0.5 * (2 * p - l2 - r2);
    }
  }
  return out;
}

/** The image turned 90° clockwise (for labels held upright). */
export function rotate90(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = gray[y * w + x];
  return out;
}

/**
 * The image turned by a small angle around its centre (bilinear), same size.
 * 1-D readers scan straight rows and fail beyond ~2° of tilt; real hands tilt more.
 */
export function rotateSmall(gray: Uint8ClampedArray, w: number, h: number, degrees: number, fill = 0): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length).fill(fill);
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      const x0 = sx | 0;
      const y0 = sy | 0;
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * w + x0;
      out[y * w + x] = (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + w] * (1 - fx) + gray[i + w + 1] * fx) * fy;
    }
  }
  return out;
}

/** Tilts tried on thorough frames, a couple per frame so each stays quick. */
export const TILTS = [-10, 10, -18, 18];

/** The image resized (bilinear). */
export function resize(gray: Uint8ClampedArray, w: number, h: number, nw: number, nh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(nw * nh);
  const fx = w / nw;
  const fy = h / nh;
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1.001, (y + 0.5) * fy - 0.5);
    const y0 = Math.max(0, sy | 0);
    const ty = Math.max(0, sy - y0);
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1.001, (x + 0.5) * fx - 0.5);
      const x0 = Math.max(0, sx | 0);
      const tx = Math.max(0, sx - x0);
      const i = y0 * w + x0;
      out[y * nw + x] = (gray[i] * (1 - tx) + gray[i + 1] * tx) * (1 - ty) + (gray[i + w] * (1 - tx) + gray[i + w + 1] * tx) * ty;
    }
  }
  return out;
}

/** The image at twice the size (bilinear), for small codes. */
export function upscale2(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const W = w * 2;
  const out = new Uint8ClampedArray(W * h * 2);
  for (let y = 0; y < h * 2; y++) {
    const sy = Math.min(h - 1, y >> 1);
    const sy2 = Math.min(h - 1, sy + (y & 1));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, x >> 1);
      const sx2 = Math.min(w - 1, sx + (x & 1));
      out[y * W + x] = (gray[sy * w + sx] + gray[sy * w + sx2] + gray[sy2 * w + sx] + gray[sy2 * w + sx2] + 2) >> 2;
    }
  }
  return out;
}

/** RGBA pixels (canvas ImageData) → grayscale. */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (306 * rgba[i] + 601 * rgba[i + 1] + 117 * rgba[i + 2] + 512) >> 10;
  return gray;
}

export function createDecoder() {
  const quick1D = reader(ONE_D, false);
  const twoD = reader([BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX], false);
  const hard2D = reader([BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX], true);

  const attempt = (r: MultiFormatReader, source: LuminanceSource, pass: string, binarizers: (new (s: LuminanceSource) => Binarizer)[]): Decoded | null => {
    for (const Binarizer of binarizers) {
      try {
        const res = r.decodeWithState(new BinaryBitmap(new Binarizer(source)));
        return { text: res.getText(), format: BarcodeFormat[res.getBarcodeFormat()], pass: `${pass}/${Binarizer === LocalRowBinarizer ? 'local' : Binarizer === HybridBinarizer ? 'hybrid' : 'global'}` };
      } catch {
        // nothing found this way
      }
    }
    return null;
  };
  const lum = (gray: Uint8ClampedArray, w: number, h: number) => new RGBLuminanceSource(gray, w, h);
  const both = [GlobalHistogramBinarizer, HybridBinarizer];
  const rows = [LocalRowBinarizer, GlobalHistogramBinarizer];
  let thorough = 0;
  const TILTS_PER_FRAME = 2;

  return (gray: Uint8ClampedArray, w: number, h: number, mode: Mode): Decoded | null => {
    // 2-D first: the squares of a QR code can fool a 1-D reader into a false read.
    if (mode === 'quick') return attempt(twoD, lum(gray, w, h), '2d', both) ?? attempt(quick1D, lum(gray, w, h), 'quick', rows);
    const start = (thorough++ * TILTS_PER_FRAME) % TILTS.length;
    // Instead of TRY_HARDER on every row (~1.5 s on an empty frame), a quick scan of three bands.
    const third = Math.floor(h / 3);
    const band = (i: number, src: Uint8ClampedArray = gray) => new RGBLuminanceSource(src, w, third, w, h, 0, i * third);
    return (
      attempt(hard2D, lum(gray, w, h), 'qr', both) ??
      // A small QR code (label held further away) has only 2–3 pixels per square: enlarge it.
      attempt(hard2D, lum(upscale2(gray, w, h), w * 2, h * 2), 'qr×2', both) ??
      // Blurry codes at the limit: a slightly smaller, smoother copy often reads.
      attempt(hard2D, lum(resize(gray, w, h, Math.round(w * 0.75), Math.round(h * 0.75)), Math.round(w * 0.75), Math.round(h * 0.75)), 'qr×¾', both) ??
      attempt(quick1D, band(1), 'band1', rows) ??
      attempt(quick1D, band(0), 'band0', rows) ??
      attempt(quick1D, band(2), 'band2', rows) ??
      attempt(quick1D, lum(sharpen(gray, w, h), w, h), 'sharp', [LocalRowBinarizer]) ??
      attempt(quick1D, lum(rotate90(gray, w, h), h, w), 'upright', [LocalRowBinarizer]) ??
      // Strongly tilted labels: straighten by a couple of angles per frame.
      TILTS.slice(start, start + TILTS_PER_FRAME).reduce<Decoded | null>(
        (hit, deg) => hit ?? attempt(quick1D, lum(rotateSmall(gray, w, h, deg), w, h), `tilt${deg}`, [LocalRowBinarizer]),
        null,
      )
    );
  };
}
