/** Shared by the camera scanner (main thread) and the decoder (barcode.ts, in a Web Worker); kept apart so the page doesn't load ZXing. */
export interface Decoded {
  text: string;
  format: string;
  /** Which pass read it (diagnostics). */
  pass: string;
}

export type Mode = 'quick' | 'thorough';

/** The framing guide over the preview, as fractions of the frame (keep in sync with .camera-guide). */
export const GUIDE = { x: 0.08, y: 0.2, w: 0.84, h: 0.6 };
