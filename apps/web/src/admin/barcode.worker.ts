/// <reference lib="webworker" />
// Decodes camera frames off the main thread so the preview and page stay smooth.
import { createDecoder, type Mode, toGray } from './barcode';

const decode = createDecoder();

// ZXing logs a warning for every frame without a code; keep the console readable.
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('MultiFormatReader')) return;
  warn(...args);
};

self.onmessage = (e: MessageEvent<{ id: number; rgba: Uint8ClampedArray; width: number; height: number; mode: Mode }>) => {
  const { id, rgba, width, height, mode } = e.data;
  let result = null;
  try {
    result = decode(toGray(rgba, width, height), width, height, mode);
  } catch (err) {
    console.warn('barcode worker', err);
  }
  (self as unknown as Worker).postMessage({ id, result });
};
