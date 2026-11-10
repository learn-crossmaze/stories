// A simple festive drawing, until an occasion has its own designs.
import { between, pick } from '../palettes';
import { confetti, flower, star } from '../motifs';
import type { Design } from '../types';

export const placeholder: Design = (r, p) =>
  confetti(r, p.acc, 50) +
  flower(540, 330, 10, 200, 70, p.acc, '#ffc93c', between(r, 0, Math.PI)) +
  star(between(r, 140, 260), between(r, 120, 220), 44, pick(r, p.acc)) +
  star(between(r, 820, 940), between(r, 120, 220), 44, pick(r, p.acc));
