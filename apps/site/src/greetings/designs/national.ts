// Drawings for the national days: New Year, Republic Day, Independence Day, Gandhi Jayanti, Kannada Rajyotsava.
import { between, pick, whole } from '../palettes';
import { balloon, bunting, burst, cloud, confetti, grass, indianFlag, kite, leaf, n, OUTLINE, sparkle, star, sun } from '../motifs';
import type { Design, Rng } from '../types';

/** New Year A: balloons and confetti. */
const balloons: Design = (r, p) => {
  let s = confetti(r, p.acc, 70);
  const count = whole(r, 6, 8);
  for (let i = 0; i < count; i++) {
    const x = 90 + (900 / (count - 1)) * i + between(r, -30, 30);
    s += balloon(x, between(r, 130, 330), pick(r, p.acc), p.ink, r);
  }
  return s;
};

/** New Year B: fireworks, streamers and party hats. */
const partyHats: Design = (r, p) => {
  let s = '';
  for (let i = 0; i < 5; i++) {
    const y0 = between(r, 20, 200);
    s += `<path d="M-20 ${n(y0)} C 260 ${n(y0 + between(r, -120, 160))}, 760 ${n(y0 + between(r, -120, 160))}, 1100 ${n(y0 + between(r, -40, 80))}" fill="none" stroke="${pick(r, p.acc)}" stroke-width="12" stroke-linecap="round" stroke-dasharray="1 26"/>`;
  }
  for (let b = 0; b < 4; b++) {
    const x = between(r, 140, 940), y = between(r, 120, 360);
    s += burst(x, y, between(r, 55, 95), pick(r, p.acc), 12, false) + star(x, y, 18, '#ffc93c');
  }
  for (const [x, tilt] of [[between(r, 170, 300), -14], [between(r, 780, 910), 12]]) {
    s += `<g transform="rotate(${tilt} ${n(x)} 560)"><path d="M${n(x - 75)} 640 L${n(x)} 420 L${n(x + 75)} 640 Z" fill="${pick(r, p.acc)}" ${OUTLINE}/>
<path d="M${n(x - 48)} 560 L${n(x + 48)} 560 M${n(x - 25)} 495 L${n(x + 25)} 495" stroke="#fff4c2" stroke-width="10" stroke-linecap="round"/>
<circle cx="${n(x)}" cy="415" r="22" fill="#ffc93c" ${OUTLINE}/></g>`;
  }
  return s;
};

// The national colours, as they must be.
const SAFFRON = '#FF9933', GREEN = '#138808', NAVY = '#000080', WHITE = '#ffffff';
const TRI = [SAFFRON, WHITE, GREEN];
const KA_YELLOW = '#FFD700', KA_RED = '#E2231A';
const STONE = '#e7b57f', STONE_DARK = '#c98d55', WOOD = '#b07a4a', WOOD_DARK = '#8a5a34';

/** A soft ink ring under white shapes, so they don't vanish on the pale card. */
const ring = (ink: string) => `stroke="${ink}" stroke-opacity=".16" stroke-width="12" stroke-linejoin="round"`;

/** A balloon that may be white: white ones get a soft ink ring. */
function triBalloon(x: number, y: number, fill: string, ink: string, r: Rng, rx = 52) {
  const halo = fill === WHITE ? `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx + 3)}" ry="${n(rx * 1.26 + 3)}" fill="none" ${ring(ink)}/>` : '';
  return halo + balloon(x, y, fill, ink, r, rx);
}

/** A flag waving on a pole: horizontal bands of equal height; (x, y) is the top of the pole. */
function bandFlag(x: number, y: number, s: number, bands: string[], pole = 330, ink = '#000') {
  const w = 180 * s, h = 120 * s, band = h / bands.length;
  const wave = (yy: number) => `M${n(x)} ${n(yy)} q${n(w / 4)} ${n(-10 * s)} ${n(w / 2)} 0 t${n(w / 2)} 0`;
  let f = '';
  bands.forEach((c, i) => {
    const yy = y + 12 * s + i * band;
    f += `<path d="${wave(yy)} v${n(band)} q${n(-w / 4)} ${n(-10 * s)} ${n(-w / 2)} 0 t${n(-w / 2)} 0 z" fill="${c}"${c === WHITE ? ` ${ring(ink)}` : ''}/>`;
  });
  return `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y + pole * s)}" stroke="#8d6e63" stroke-width="${n(9 * s)}" stroke-linecap="round"/>
${f}<circle cx="${n(x)}" cy="${n(y - 4 * s)}" r="${n(8 * s)}" fill="#ffc93c"/>`;
}

/** Karnataka's flag: yellow over red. */
const karnatakaFlag = (x: number, y: number, s = 1, pole = 330) => bandFlag(x, y, s, [KA_YELLOW, KA_RED], pole);

/** A diamond kite in saffron, white and green bands with a navy dot; (x, y) is its middle. */
function tricolourKite(x: number, y: number, s: number, ink: string, tilt = 0) {
  const top = -70, bot = 82, hw = (yy: number) => (yy <= 0 ? (52 * (yy - top)) / -top : (52 * (bot - yy)) / bot);
  const y1 = top + (bot - top) / 3, y2 = top + (2 * (bot - top)) / 3;
  const P = (dx: number, dy: number) => `${n(x + dx * s)},${n(y + dy * s)}`;
  const bands = [
    [P(0, top), P(hw(y1), y1), P(-hw(y1), y1)],
    [P(-hw(y1), y1), P(hw(y1), y1), P(52, 0), P(hw(y2), y2), P(-hw(y2), y2), P(-52, 0)],
    [P(-hw(y2), y2), P(hw(y2), y2), P(0, bot)],
  ];
  const outline = `M${P(0, top)} L${P(52, 0)} L${P(0, bot)} L${P(-52, 0)} Z`;
  return `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})">
<path d="${outline}" fill="none" ${ring(ink)}/>
${bands.map((b, i) => `<polygon points="${b.join(' ')}" fill="${TRI[i]}"/>`).join('')}
<path d="${outline}" fill="none" ${OUTLINE}/>
<circle cx="${n(x)}" cy="${n(y + 6 * s)}" r="${n(10 * s)}" fill="${NAVY}"/>
<path d="M${P(0, bot)} q${n(-30 * s)} ${n(30 * s)} 0 ${n(60 * s)} q${n(30 * s)} ${n(30 * s)} 0 ${n(60 * s)}" fill="none" stroke="${GREEN}" stroke-width="5" stroke-linecap="round"/>
<path d="M${P(-12, bot + 30)} l${n(24 * s)} ${n(-12 * s)}" stroke="${SAFFRON}" stroke-width="10" stroke-linecap="round"/>
<path d="M${P(-12, bot + 90)} l${n(24 * s)} ${n(-12 * s)}" stroke="${GREEN}" stroke-width="10" stroke-linecap="round"/></g>`;
}

/** A parade drum standing on the floor; (x, y) is the middle of its base. */
function drum(x: number, y: number, s: number, body: string, tilt = 0) {
  const w = 130 * s, h = 120 * s, ry = 22 * s, top = y - h;
  let zig = `M${n(x - w / 2)} ${n(top + 14 * s)}`;
  for (let i = 1; i <= 6; i++) zig += ` L${n(x - w / 2 + (w / 6) * i)} ${n(i % 2 ? y - 14 * s : top + 14 * s)}`;
  return `<g transform="rotate(${n(tilt)} ${n(x)} ${n(y)})">
<path d="M${n(x - w / 2)} ${n(top)} V${n(y)} A${n(w / 2)} ${n(ry)} 0 0 0 ${n(x + w / 2)} ${n(y)} V${n(top)} Z" fill="${body}" ${OUTLINE}/>
<path d="${zig}" fill="none" stroke="#fff4c2" stroke-width="${n(6 * s)}" stroke-linejoin="round"/>
<path d="M${n(x - w / 2)} ${n(y)} A${n(w / 2)} ${n(ry)} 0 0 0 ${n(x + w / 2)} ${n(y)}" fill="none" stroke="${GREEN}" stroke-width="${n(12 * s)}"/>
<ellipse cx="${n(x)}" cy="${n(top)}" rx="${n(w / 2)}" ry="${n(ry)}" fill="#fff4c2" stroke="${SAFFRON}" stroke-width="${n(10 * s)}"/>
<path d="M${n(x - 20 * s)} ${n(top - 8 * s)} L${n(x - 80 * s)} ${n(top - 80 * s)} M${n(x + 20 * s)} ${n(top - 8 * s)} L${n(x + 80 * s)} ${n(top - 80 * s)}" stroke="${WOOD}" stroke-width="${n(9 * s)}" stroke-linecap="round"/>
<circle cx="${n(x - 80 * s)}" cy="${n(top - 80 * s)}" r="${n(12 * s)}" fill="${SAFFRON}" stroke="#fff" stroke-width="3"/>
<circle cx="${n(x + 80 * s)}" cy="${n(top - 80 * s)}" r="${n(12 * s)}" fill="${GREEN}" stroke="#fff" stroke-width="3"/></g>`;
}

/** Republic Day A: the flag flying high, tricolour bunting, parade drums and balloons. */
const flagParade: Design = (r, p) => {
  let s = bunting(30, 22, 1050, 22, TRI, whole(r, 11, 14), 30);
  const x = between(r, 390, 430), sc = 1.6;
  s += `<path d="M${n(x - 70)} 640 h140 l-16 -34 h-108 z" fill="${STONE}" ${OUTLINE}/>`;
  s += indianFlag(x, 112, sc);
  for (const side of [-1, 1]) {
    const dx = x + 144 + side * between(r, 340, 390);
    s += drum(dx, 630, between(r, 0.95, 1.1), pick(r, p.acc), between(r, -4, 4));
  }
  for (const [bx, by, c] of [[between(r, 90, 150), between(r, 160, 220), SAFFRON], [between(r, 930, 990), between(r, 160, 220), GREEN]] as const)
    s += triBalloon(bx, by, c, p.ink, r, 48);
  for (let i = 0; i < 4; i++) s += sparkle(between(r, 240, 860), between(r, 120, 400) , between(r, 12, 20), pick(r, p.acc));
  return s;
};

/** India Gate as a simple sandstone arch; (cx, 640) is the middle of its base. */
function indiaGate(cx: number, ink: string) {
  return `<path d="M${n(cx - 230)} 640 V612 H${n(cx - 200)} V588 H${n(cx + 200)} V612 H${n(cx + 230)} V640 Z" fill="${STONE_DARK}" ${OUTLINE}/>
<path d="M${n(cx - 170)} 590 V300 H${n(cx + 170)} V590 H${n(cx + 72)} V430 A72 72 0 0 0 ${n(cx - 72)} 430 V590 Z" fill="${STONE}" ${OUTLINE}/>
<rect x="${n(cx - 186)}" y="278" width="372" height="26" rx="6" fill="${STONE_DARK}" ${OUTLINE}/>
<rect x="${n(cx - 140)}" y="226" width="280" height="56" rx="4" fill="${STONE}" ${OUTLINE}/>
<rect x="${n(cx - 156)}" y="212" width="312" height="20" rx="6" fill="${STONE_DARK}" ${OUTLINE}/>
<path d="M${n(cx - 62)} 212 A62 36 0 0 1 ${n(cx + 62)} 212 Z" fill="${STONE}" ${OUTLINE}/>
<path d="M${n(cx - 132)} 340 h44 M${n(cx + 88)} 340 h44 M${n(cx - 132)} 470 h44 M${n(cx + 88)} 470 h44" stroke="${STONE_DARK}" stroke-width="8" stroke-linecap="round"/>
<path d="M${n(cx - 72)} 590 V430 A72 72 0 0 1 ${n(cx + 72)} 430 V590" fill="none" stroke="${ink}" stroke-opacity=".12" stroke-width="10"/>`;
}

/** Republic Day B: India Gate between two flags, under tricolour flypast trails. */
const gate: Design = (r, p) => {
  const cx = between(r, 520, 560), lift = between(r, -30, 30), bend = between(r, -40, 40);
  let s = '';
  [SAFFRON, WHITE, GREEN].forEach((c, i) => {
    const y = 250 + lift + i * 30;
    const d = `M30 ${n(y + 80)} C 300 ${n(y - 150 + bend)}, 780 ${n(y - 150 - bend)}, 1050 ${n(y + 80)}`;
    if (c === WHITE) s += `<path d="${d}" fill="none" stroke="${p.ink}" stroke-opacity=".14" stroke-width="32" stroke-linecap="round"/>`;
    s += `<path d="${d}" fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round"/>`;
  });
  s += sun(between(r, 130, 200), between(r, 90, 120), 42, '#ffc93c', true);
  s += indiaGate(cx, p.ink);
  s += indianFlag(cx - 400, 320, 0.95) + indianFlag(cx + 222, 320, 0.95);
  s += grass(r, '#5cc98a', 652);
  for (let i = 0; i < 3; i++) s += star(between(r, 700, 1000), between(r, 50, 130), between(r, 14, 22), pick(r, p.acc), r());
  return s;
};

/** Independence Day A: tricolour kites flying high, their strings down to a reel on the grass. */
const kites: Design = (r, p) => {
  let s = '';
  const reelX = between(r, 480, 600), reelY = 590;
  const count = whole(r, 3, 4);
  const spots: [number, number][] = [];
  for (let i = 0; i < count; i++) spots.push([170 + (740 / (count - 1)) * i + between(r, -20, 20), between(r, 170, 250) + (i % 2) * 50]);
  for (let i = 1; i < count; i++) s += cloud((spots[i - 1][0] + spots[i][0]) / 2 + between(r, -15, 15), between(r, 100, 130), count > 3 ? 0.55 : 0.75);
  for (const [x, y] of spots)
    s += `<path d="M${n(x)} ${n(y)} Q${n((x + reelX) / 2 + between(r, -60, 60))} ${n((y + reelY) / 2 + 80)} ${n(reelX)} ${n(reelY - 40)}" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".4"/>`;
  const plain = count - 1 - Math.floor(r() * 2);
  spots.forEach(([x, y], i) => {
    const tilt = between(r, -16, 16), sc = between(r, 1.2, 1.45) - (count - 3) * 0.12;
    s += i % 2 === 0 || i > plain ? tricolourKite(x, y, sc, p.ink, tilt) : kite(x, y, sc, pick(r, p.acc), pick(r, [SAFFRON, GREEN]), tilt);
  });
  s += grass(r, '#5cc98a', 652);
  // The reel (charkhi): two wheels joined by a drum of string, with handles.
  s += `<path d="M${n(reelX - 52)} ${n(reelY - 40)} h104 v56 h-104 z" fill="${pick(r, p.acc)}" ${OUTLINE}/>
<path d="M${n(reelX - 40)} ${n(reelY - 28)} h80 M${n(reelX - 40)} ${n(reelY - 12)} h80 M${n(reelX - 40)} ${n(reelY + 4)} h80" stroke="#fff4c2" stroke-width="5" stroke-linecap="round"/>
<ellipse cx="${n(reelX - 56)}" cy="${n(reelY - 12)}" rx="16" ry="50" fill="${WOOD}" ${OUTLINE}/>
<ellipse cx="${n(reelX + 56)}" cy="${n(reelY - 12)}" rx="16" ry="50" fill="${WOOD}" ${OUTLINE}/>
<path d="M${n(reelX - 72)} ${n(reelY - 12)} h-46 M${n(reelX + 72)} ${n(reelY - 12)} h46" stroke="${WOOD_DARK}" stroke-width="14" stroke-linecap="round"/>`;
  return s;
};

/** Independence Day B: a big bunch of saffron, white and green balloons tied with a bow, small flags below. */
const balloonBunch: Design = (r, p) => {
  let s = '';
  const kx = 540, ky = 520, cols = [SAFFRON, WHITE, GREEN];
  const spots: [number, number, string][] = [];
  const rings = [[0, 0, 1], [118, 140, 6]] as const;
  const rot = between(r, 0, Math.PI);
  let k = whole(r, 0, 2);
  for (const [rx, ry, count] of rings)
    for (let i = 0; i < count; i++) {
      const a = rot + (2 * Math.PI * i) / count;
      spots.push([kx + Math.cos(a) * rx + between(r, -8, 8), 250 + Math.sin(a) * ry * 0.72 + between(r, -8, 8), cols[k++ % 3]]);
    }
  spots.sort((a, b) => a[1] - b[1]);
  for (const [x, y] of spots)
    s += `<path d="M${n(x)} ${n(y + 64)} Q${n((x + kx) / 2 + between(r, -20, 20))} ${n((y + ky) / 2 + 30)} ${kx} ${ky}" fill="none" stroke="${p.ink}" stroke-width="3" opacity=".45"/>`;
  for (const [x, y, c] of spots) {
    const rx = 50;
    s += (c === WHITE ? `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${rx + 3}" ry="${n(rx * 1.26 + 3)}" fill="none" ${ring(p.ink)}/>` : '') +
      `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${rx}" ry="${n(rx * 1.26)}" fill="${c}" ${OUTLINE}/>
<ellipse cx="${n(x - rx * 0.32)}" cy="${n(y - rx * 0.45)}" rx="${n(rx * 0.19)}" ry="${n(rx * 0.32)}" fill="#fff" opacity=".55"/>
<path d="M${n(x - 9)} ${n(y + 72)} h18 l-9 -9 z" fill="${c}"/>`;
  }
  // Every third balloon shows the chakra, so the bunch reads as India's colours.
  const centre = spots.find(([, , c]) => c === WHITE);
  if (centre) s += `<circle cx="${n(centre[0])}" cy="${n(centre[1])}" r="18" fill="none" stroke="${NAVY}" stroke-width="4"/><circle cx="${n(centre[0])}" cy="${n(centre[1])}" r="4" fill="${NAVY}"/>`;
  const bow = pick(r, p.acc);
  s += `<path d="M${kx} ${ky} q-46 -30 -52 6 q8 30 52 -6 z M${kx} ${ky} q46 -30 52 6 q-8 30 -52 -6 z" fill="${bow}" ${OUTLINE}/>
<path d="M${kx} ${ky} q-20 50 -36 92 M${kx} ${ky} q22 46 30 96" fill="none" stroke="${bow}" stroke-width="10" stroke-linecap="round"/>
<circle cx="${kx}" cy="${ky}" r="13" fill="${bow}" stroke="#fff" stroke-width="4"/>`;
  s += indianFlag(between(r, 110, 160), 400, 0.72) + indianFlag(between(r, 800, 840), 400, 0.72);
  s += grass(r, '#5cc98a', 652);
  for (let i = 0; i < 5; i++) s += sparkle(between(r, 60, 1020), between(r, 40, 340), between(r, 12, 20), pick(r, [SAFFRON, GREEN, ...p.acc]));
  return s;
};

/** Gandhi Jayanti A: a charkha (spinning wheel) with its thread, a cotton ball and folded khadi. */
const charkha: Design = (r, p) => {
  const cx = between(r, 380, 430), cy = 370, R = 185, spokes = pick(r, [8, 10, 12]), rot = r() * Math.PI;
  let s = '';
  for (let i = 0; i < 4; i++) s += leaf(between(r, 60, 1020), between(r, 60, 220), between(r, 40, 60), pick(r, ['#8bc34a', '#5cc98a', '#7cb342']), between(r, -70, 20));
  // The stand: base plank, legs and the spindle post.
  s += `<rect x="${n(cx - 230)}" y="598" width="${n(720)}" height="36" rx="12" fill="${WOOD_DARK}" ${OUTLINE}/>
<path d="M${n(cx - 110)} 600 L${n(cx)} ${cy} L${n(cx + 110)} 600" fill="none" stroke="${WOOD}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="${n(cx + 400)}" y="470" width="30" height="132" rx="8" fill="${WOOD}" ${OUTLINE}/>
<path d="M${n(cx + 360)} 480 h110" stroke="${WOOD_DARK}" stroke-width="10" stroke-linecap="round"/>`;
  // The wheel.
  let sp = '';
  for (let i = 0; i < spokes; i++) {
    const a = rot + (2 * Math.PI * i) / spokes;
    sp += `M${n(cx)} ${cy} L${n(cx + Math.cos(a) * (R - 10))} ${n(cy + Math.sin(a) * (R - 10))} `;
  }
  s += `<path d="${sp.trim()}" stroke="#fff" stroke-width="18" stroke-linecap="round"/><path d="${sp.trim()}" stroke="${WOOD}" stroke-width="10" stroke-linecap="round"/>
<circle cx="${n(cx)}" cy="${cy}" r="${R}" fill="none" stroke="#fff" stroke-width="34"/>
<circle cx="${n(cx)}" cy="${cy}" r="${R}" fill="none" stroke="${WOOD}" stroke-width="24"/>
<circle cx="${n(cx)}" cy="${cy}" r="${R}" fill="none" stroke="${WOOD_DARK}" stroke-width="5" stroke-dasharray="4 18"/>
<circle cx="${n(cx)}" cy="${cy}" r="34" fill="${pick(r, p.acc)}" ${OUTLINE}/>
<path d="M${n(cx)} ${cy} l-60 -46" stroke="${WOOD_DARK}" stroke-width="12" stroke-linecap="round"/><circle cx="${n(cx - 60)}" cy="${cy - 46}" r="12" fill="${WOOD_DARK}" stroke="#fff" stroke-width="4"/>`;
  // The thread from the wheel to the spindle, and the spun yarn on it.
  s += `<path d="M${n(cx + 20)} ${cy - R} L${n(cx + 430)} 470 M${n(cx + 20)} ${cy + R} L${n(cx + 430)} 490" stroke="#fff" stroke-width="4" opacity=".9"/>
<path d="M${n(cx + 20)} ${cy - R} L${n(cx + 430)} 470 M${n(cx + 20)} ${cy + R} L${n(cx + 430)} 490" stroke="${p.ink}" stroke-width="2" opacity=".35"/>
<ellipse cx="${n(cx + 445)}" cy="480" rx="26" ry="16" fill="#fffaf0" ${ring(p.ink)}/><ellipse cx="${n(cx + 445)}" cy="480" rx="26" ry="16" fill="#fffaf0"/>`;
  // A cotton ball and a folded khadi cloth.
  const bx = cx + 360;
  s += `<g><path d="M${n(bx - 50)} 600 a26 26 0 0 1 12 -44 a30 30 0 0 1 52 -10 a26 26 0 0 1 36 30 a22 22 0 0 1 0 24 z" fill="#fffaf0" ${ring(p.ink)}/><path d="M${n(bx - 50)} 600 a26 26 0 0 1 12 -44 a30 30 0 0 1 52 -10 a26 26 0 0 1 36 30 a22 22 0 0 1 0 24 z" fill="#fffaf0"/></g>`;
  const kh = pick(r, ['#f3ead2', '#e8f0d8']);
  s += `<rect x="${n(cx - 220)}" y="566" width="150" height="34" rx="8" fill="${kh}" ${ring(p.ink)}/><rect x="${n(cx - 220)}" y="566" width="150" height="34" rx="8" fill="${kh}"/>
<rect x="${n(cx - 210)}" y="536" width="130" height="32" rx="8" fill="${pick(r, ['#cfe3b0', '#bfd9c8'])}" ${OUTLINE}/>
<path d="M${n(cx - 210)} 583 h150" stroke="${p.ink}" stroke-opacity=".15" stroke-width="4"/>`;
  return s;
};

/** A white dove of peace flying right with a green twig; (x, y) is its body. */
function dove(x: number, y: number, s: number, ink: string, flap = 0) {
  const P = (dx: number, dy: number) => `${n(x + dx * s)} ${n(y + dy * s)}`;
  const body = `M${P(-150, -30)} L${P(-80, 0)} Q${P(-40, 44)} ${P(30, 30)} Q${P(70, 20)} ${P(80, -20)} Q${P(80, -66)} ${P(50, -66)} Q${P(26, -66)} ${P(26, -36)} Q${P(-20, -10)} ${P(-90, -14)} L${P(-152, 10)} Z`;
  const wing = `M${P(-30, -16)} Q${P(-90, -110 - flap)} ${P(-30, -150 - flap)} Q${P(-10, -120 - flap)} ${P(0, -112 - flap)} Q${P(14, -90 - flap)} ${P(20, -80 - flap)} Q${P(34, -56)} ${P(30, -26)} Z`;
  const twig = `M${P(86, -42)} q${n(40 * s)} ${n(10 * s)} ${n(80 * s)} ${n(36 * s)}`;
  return `<path d="${twig}" fill="none" stroke="#5a8f3a" stroke-width="${n(7 * s)}" stroke-linecap="round"/>
${leaf(x + 112 * s, y - 34 * s, 40 * s, '#7cb342', -40)}${leaf(x + 136 * s, y - 20 * s, 38 * s, '#8bc34a', 40)}${leaf(x + 160 * s, y - 8 * s, 34 * s, '#7cb342', -30)}
<g fill="#fff" stroke="${ink}" stroke-opacity=".18" stroke-width="12" stroke-linejoin="round"><path d="${body}"/><path d="${wing}"/></g>
<g fill="#fff"><path d="${body}"/><path d="${wing}"/></g>
<path d="M${P(-20, -96 - flap)} q${n(14 * s)} ${n(18 * s)} ${n(30 * s)} ${n(24 * s)} M${P(-30, -60)} q${n(20 * s)} ${n(10 * s)} ${n(44 * s)} ${n(10 * s)}" fill="none" stroke="${ink}" stroke-opacity=".18" stroke-width="${n(5 * s)}" stroke-linecap="round"/>
<path d="M${P(78, -50)} l${n(22 * s)} ${n(8 * s)} l${n(-20 * s)} ${n(10 * s)} z" fill="#ffb74d"/>
<circle cx="${n(x + 58 * s)}" cy="${n(y - 46 * s)}" r="${n(6 * s)}" fill="${ink}"/>`;
}

/** Gandhi Jayanti B: round wire spectacles resting on folded khadi, a dove of peace above. */
const spectacles: Design = (r, p) => {
  let s = '';
  const cx = between(r, 520, 560), cy = 470, gap = 118, R = 84;
  for (let i = 0; i < 3; i++) s += sparkle(between(r, 70, 1010), between(r, 40, 300), between(r, 10, 16), pick(r, p.acc));
  // Folded khadi cloth.
  const kh = pick(r, ['#f3ead2', '#eef3dc']), kh2 = pick(r, ['#cfe3b0', '#bfd9c8', '#e8d6b0']);
  s += `<path d="M${n(cx - 320)} 640 L${n(cx - 290)} 560 H${n(cx + 290)} L${n(cx + 320)} 640 Z" fill="${kh}" ${ring(p.ink)}/>
<path d="M${n(cx - 320)} 640 L${n(cx - 290)} 560 H${n(cx + 290)} L${n(cx + 320)} 640 Z" fill="${kh}"/>
<path d="M${n(cx - 305)} 600 H${n(cx + 305)}" stroke="${kh2}" stroke-width="16"/>
<path d="M${n(cx - 300)} 622 H${n(cx + 300)}" stroke="${p.ink}" stroke-opacity=".1" stroke-width="4" stroke-dasharray="10 12"/>`;
  // Spectacles: two round lenses, a bridge and the arms folded behind.
  const frame = '#5d4037';
  s += `<path d="M${n(cx - gap - R + 6)} ${cy - 20} q-40 30 -10 90 M${n(cx + gap + R - 6)} ${cy - 20} q40 30 10 90" fill="none" stroke="${frame}" stroke-width="10" stroke-linecap="round"/>
<circle cx="${n(cx - gap)}" cy="${cy}" r="${R}" fill="#eaf6ff" fill-opacity=".75" stroke="#fff" stroke-width="22"/>
<circle cx="${n(cx + gap)}" cy="${cy}" r="${R}" fill="#eaf6ff" fill-opacity=".75" stroke="#fff" stroke-width="22"/>
<circle cx="${n(cx - gap)}" cy="${cy}" r="${R}" fill="none" stroke="${frame}" stroke-width="11"/>
<circle cx="${n(cx + gap)}" cy="${cy}" r="${R}" fill="none" stroke="${frame}" stroke-width="11"/>
<path d="M${n(cx - gap + R)} ${cy - 8} q${n(gap - R)} -30 ${n(2 * (gap - R))} 0" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round"/>
<path d="M${n(cx - gap + R)} ${cy - 8} q${n(gap - R)} -30 ${n(2 * (gap - R))} 0" fill="none" stroke="${frame}" stroke-width="10" stroke-linecap="round"/>
<path d="M${n(cx - gap - 46)} ${cy - 30} a50 50 0 0 1 36 -34 M${n(cx + gap - 46)} ${cy - 30} a50 50 0 0 1 36 -34" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".9"/>`;
  // The dove, and a few leaves.
  const dx = between(r, 420, 540), dy = between(r, 215, 235);
  s += dove(dx, dy, between(r, 1.2, 1.35), p.ink, between(r, -10, 15));
  for (const side of [-1, 1]) {
    const lx = cx + side * between(r, 360, 420);
    s += `<path d="M${n(lx)} 640 q${n(side * -10)} -70 ${n(side * 10)} -140" fill="none" stroke="#5a8f3a" stroke-width="7" stroke-linecap="round"/>`;
    for (let i = 0; i < 3; i++) s += leaf(lx + side * 4, 610 - i * 42, between(r, 46, 60), pick(r, ['#8bc34a', '#5cc98a', '#7cb342']), side < 0 ? -150 + i * 10 : -30 - i * 10);
  }
  return s;
};

/** Small white jasmine flower with a soft ink ring. */
function jasmine(x: number, y: number, s: number, ink: string, rot = 0) {
  let petals = '';
  for (let i = 0; i < 5; i++) {
    const a = rot + (2 * Math.PI * i) / 5;
    const px = x + Math.cos(a) * 11 * s, py = y + Math.sin(a) * 11 * s;
    petals += `<ellipse cx="${n(px)}" cy="${n(py)}" rx="${n(11 * s)}" ry="${n(6.5 * s)}" transform="rotate(${n((a * 180) / Math.PI)} ${n(px)} ${n(py)})"/>`;
  }
  return `<g fill="#fff" stroke="${ink}" stroke-opacity=".2" stroke-width="7">${petals}</g><g fill="#fff">${petals}</g><circle cx="${n(x)}" cy="${n(y)}" r="${n(4 * s)}" fill="#ffd54f"/>`;
}

/** A hanging string of jasmine from (x, y0) down `len`. */
function jasmineString(x: number, y0: number, len: number, ink: string, r: Rng) {
  let s = `<line x1="${n(x)}" y1="${n(y0)}" x2="${n(x)}" y2="${n(y0 + len)}" stroke="#5a8f3a" stroke-width="3"/>`;
  for (let y = y0 + 24; y <= y0 + len; y += 30) s += jasmine(x + between(r, -3, 3), y, 0.9, ink, r() * 6);
  return s;
}

/** An onion dome on a drum; (x, base) is the middle of its base, w its width. */
function dome(x: number, base: number, w: number, fill: string, drumFill: string) {
  const h = w * 1.05, dh = w * 0.38;
  return `<rect x="${n(x - w * 0.42)}" y="${n(base - dh)}" width="${n(w * 0.84)}" height="${n(dh)}" fill="${drumFill}" ${OUTLINE}/>
<path d="M${n(x - w / 2)} ${n(base - dh)} C${n(x - w / 2)} ${n(base - dh - h * 0.55)} ${n(x - w * 0.1)} ${n(base - dh - h * 0.7)} ${n(x)} ${n(base - dh - h)} C${n(x + w * 0.1)} ${n(base - dh - h * 0.7)} ${n(x + w / 2)} ${n(base - dh - h * 0.55)} ${n(x + w / 2)} ${n(base - dh)} Z" fill="${fill}" ${OUTLINE}/>
<circle cx="${n(x)}" cy="${n(base - dh - h - 8)}" r="${n(Math.max(7, w * 0.07))}" fill="#ffc93c" stroke="#fff" stroke-width="3"/>`;
}

/** Rajyotsava A: a Mysuru-palace-like building with domes, Karnataka flags, bunting and jasmine. */
const palace: Design = (r, p) => {
  const cx = between(r, 520, 560), body = '#f2cf96', dark = '#d9a35f', domeC = pick(r, ['#e0533f', '#d84a3a', '#e46a4c']);
  let s = '';
  // Main block with a row of arches.
  const arches = pick(r, [5, 7]), left = cx - 330, w = 660, aw = w / arches;
  s += `<rect x="${n(left - 20)}" y="604" width="${n(w + 40)}" height="36" rx="8" fill="${dark}" ${OUTLINE}/>
<rect x="${n(left)}" y="440" width="${w}" height="166" fill="${body}" ${OUTLINE}/>
<rect x="${n(left - 12)}" y="428" width="${n(w + 24)}" height="20" rx="6" fill="${dark}" ${OUTLINE}/>`;
  for (let i = 0; i < arches; i++) {
    const ax = left + aw * i + aw / 2, hw = aw * 0.3;
    s += `<path d="M${n(ax - hw)} 604 V530 A${n(hw)} ${n(hw)} 0 0 1 ${n(ax + hw)} 530 V604 Z" fill="${dark}" stroke="#fff" stroke-width="4"/>`;
  }
  // Side towers, with a flag on each dome.
  const sideTop = 330, sideW = 84, sideTip = sideTop - sideW * 1.43 - 8;
  for (const side of [-1, 1]) {
    const tx = cx + side * 290;
    s += `<line x1="${n(tx)}" y1="${n(sideTip - 70)}" x2="${n(tx)}" y2="${n(sideTip)}" stroke="#8d6e63" stroke-width="5" stroke-linecap="round"/>` +
      karnatakaFlag(tx, sideTip - 70, 0.36, 0) +
      `<rect x="${n(tx - 46)}" y="${sideTop}" width="92" height="${440 - sideTop}" fill="${body}" ${OUTLINE}/>
<path d="M${n(tx - 20)} 410 V370 a20 20 0 0 1 40 0 V410 Z" fill="${dark}"/>` + dome(tx, sideTop + 2, sideW, domeC, body);
  }
  // The tall middle tower, its dome and the big flag.
  const midTop = 300, midW = between(r, 128, 140), midTip = midTop - midW * 1.43 - 10;
  s += `<line x1="${n(cx)}" y1="${n(midTip - 90)}" x2="${n(cx)}" y2="${n(midTip)}" stroke="#8d6e63" stroke-width="6" stroke-linecap="round"/>` +
    karnatakaFlag(cx, midTip - 90, 0.5, 0);
  s += `<rect x="${n(cx - 88)}" y="${midTop}" width="176" height="${440 - midTop}" fill="${body}" ${OUTLINE}/>
<rect x="${n(cx - 100)}" y="${midTop - 10}" width="200" height="18" rx="6" fill="${dark}" ${OUTLINE}/>
<path d="M${n(cx - 38)} 440 V370 a38 38 0 0 1 76 0 V440 Z" fill="${dark}" stroke="#fff" stroke-width="4"/>` + dome(cx, midTop - 8, midW, domeC, body);
  // Yellow-and-red bunting swags between the towers.
  const flags = whole(r, 4, 5);
  s += bunting(cx - 246, sideTop + 30, cx - 100, midTop + 30, [KA_YELLOW, KA_RED], flags, 14) + bunting(cx + 100, midTop + 30, cx + 246, sideTop + 30, [KA_RED, KA_YELLOW], flags, 14);
  // Jasmine strings at the sides.
  s += jasmineString(between(r, 70, 100), 40, between(r, 220, 320), p.ink, r) + jasmineString(between(r, 980, 1010), 40, between(r, 220, 320), p.ink, r);
  for (let i = 0; i < 4; i++) s += sparkle(between(r, 150, 930), between(r, 40, 200), between(r, 10, 16), pick(r, [KA_YELLOW, KA_RED, ...p.acc]));
  return s;
};

/** A friendly elephant facing right, in a festive yellow-and-red cloth; (x, y) is the middle of its back feet. */
function elephant(x: number, y: number, ink: string, cloth: string, trim: string, r: Rng) {
  const grey = '#a9b4c4', grey2 = '#94a0b2';
  const bx = x + 110, by = y - 200;
  let s = '';
  // Far legs (darker), body, near legs, tail.
  s += `<rect x="${n(bx - 120)}" y="${n(by + 40)}" width="58" height="${n(y - by - 40)}" rx="24" fill="${grey2}" ${OUTLINE}/>
<rect x="${n(bx + 80)}" y="${n(by + 40)}" width="58" height="${n(y - by - 40)}" rx="24" fill="${grey2}" ${OUTLINE}/>
<path d="M${n(bx - 176)} ${n(by - 30)} q-34 30 -24 84" fill="none" stroke="${grey2}" stroke-width="10" stroke-linecap="round"/>
<path d="M${n(bx - 200)} ${n(by + 60)} l-8 22 l14 -6 l8 18 l6 -26 z" fill="${grey2}"/>
<ellipse cx="${n(bx)}" cy="${n(by)}" rx="190" ry="130" fill="${grey}" ${OUTLINE}/>
<rect x="${n(bx - 160)}" y="${n(by + 50)}" width="64" height="${n(y - by - 50)}" rx="26" fill="${grey}" ${OUTLINE}/>
<rect x="${n(bx + 40)}" y="${n(by + 50)}" width="64" height="${n(y - by - 50)}" rx="26" fill="${grey}" ${OUTLINE}/>`;
  for (const lx of [bx - 128, bx + 72]) s += `<path d="M${n(lx - 22)} ${n(y - 6)} h12 M${n(lx - 6)} ${n(y - 6)} h12 M${n(lx + 10)} ${n(y - 6)} h12" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".8"/>`;
  // The cloth on its back, with a trim, tassels and dots.
  const clothPath = `M${n(bx - 130)} ${n(by - 96)} Q${n(bx)} ${n(by - 140)} ${n(bx + 120)} ${n(by - 100)} L${n(bx + 110)} ${n(by + 40)} Q${n(bx)} ${n(by + 70)} ${n(bx - 120)} ${n(by + 40)} Z`;
  s += `<path d="${clothPath}" fill="${cloth}" ${OUTLINE}/>
<path d="M${n(bx + 110)} ${n(by + 40)} Q${n(bx)} ${n(by + 70)} ${n(bx - 120)} ${n(by + 40)}" fill="none" stroke="${trim}" stroke-width="16"/>`;
  for (let i = 0; i < 6; i++) {
    const t = i / 5, tx = bx - 112 + 216 * t, ty = by + 46 + Math.sin(Math.PI * t) * 20;
    s += `<path d="M${n(tx)} ${n(ty)} v20" stroke="${trim}" stroke-width="6" stroke-linecap="round"/><circle cx="${n(tx)}" cy="${n(ty + 26)}" r="7" fill="${trim}" stroke="#fff" stroke-width="2"/>`;
  }
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    s += `<circle cx="${n(bx - 100 + 200 * t)}" cy="${n(by - 30 + between(r, -8, 8))}" r="11" fill="${trim}" stroke="#fff" stroke-width="3"/>`;
  }
  // Head, ear, trunk and a decorated forehead.
  const hx = bx + 200, hy = by - 40;
  const trunk = `M${n(hx + 60)} ${n(hy + 40)} Q${n(hx + 140)} ${n(hy + 70)} ${n(hx + 150)} ${n(hy - 10)} Q${n(hx + 156)} ${n(hy - 70)} ${n(hx + 180)} ${n(hy - 84)}`;
  s += `<line x1="${n(hx + 186)}" y1="${n(hy - 250)}" x2="${n(hx + 186)}" y2="${n(hy - 40)}" stroke="#8d6e63" stroke-width="8" stroke-linecap="round"/>
${karnatakaFlag(hx + 186, hy - 250, 0.8, 0)}
<path d="${trunk}" fill="none" stroke="#fff" stroke-width="50" stroke-linecap="round"/>
<path d="${trunk}" fill="none" stroke="${grey}" stroke-width="40" stroke-linecap="round"/>
<path d="M${n(hx + 120)} ${n(hy + 24)} h24 M${n(hx + 130)} ${n(hy - 6)} h22 M${n(hx + 140)} ${n(hy - 36)} h20" stroke="${grey2}" stroke-width="5" stroke-linecap="round"/>
<circle cx="${n(hx)}" cy="${n(hy)}" r="105" fill="${grey}" ${OUTLINE}/>
<path d="M${n(hx - 20)} ${n(hy - 70)} Q${n(hx - 130)} ${n(hy - 90)} ${n(hx - 120)} ${n(hy + 20)} Q${n(hx - 110)} ${n(hy + 110)} ${n(hx - 20)} ${n(hy + 70)} Z" fill="${grey2}" ${OUTLINE}/>
<path d="M${n(hx - 30)} ${n(hy - 50)} Q${n(hx - 100)} ${n(hy - 60)} ${n(hx - 96)} ${n(hy + 14)} Q${n(hx - 88)} ${n(hy + 70)} ${n(hx - 30)} ${n(hy + 48)}" fill="none" stroke="#f4c6c9" stroke-width="10" stroke-linecap="round" opacity=".8"/>
<path d="M${n(hx + 20)} ${n(hy - 100)} Q${n(hx + 80)} ${n(hy - 80)} ${n(hx + 92)} ${n(hy - 6)} L${n(hx + 50)} ${n(hy + 30)} Q${n(hx + 30)} ${n(hy - 40)} ${n(hx + 20)} ${n(hy - 100)} Z" fill="${cloth}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
<circle cx="${n(hx + 56)}" cy="${n(hy - 40)}" r="10" fill="${trim}" stroke="#fff" stroke-width="3"/>
<circle cx="${n(hx + 40)}" cy="${n(hy + 4)}" r="11" fill="${ink}"/><circle cx="${n(hx + 44)}" cy="${n(hy)}" r="4" fill="#fff"/>
<circle cx="${n(hx + 20)}" cy="${n(hy + 40)}" r="13" fill="#ff8fa3" opacity=".55"/>
<path d="M${n(hx + 30)} ${n(hy + 62)} q18 18 40 4" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round" opacity=".6"/>`;
  return s;
}

/** Rajyotsava B: a friendly decorated elephant raising Karnataka's flag, with jasmine and bunting. */
const elephantDay: Design = (r, p) => {
  const ex = between(r, 170, 230);
  let s = bunting(30, 22, 1050, 22, [KA_YELLOW, KA_RED], whole(r, 11, 14), 28);
  s += sun(between(r, 130, 190), between(r, 150, 180), 44, '#ffc93c', true);
  s += elephant(ex, 630, p.ink, KA_RED, KA_YELLOW, r);
  s += grass(r, '#7cb342', 652);
  const count = whole(r, 3, 4);
  for (let i = 0; i < count; i++) s += jasmine(between(r, 680, 1020), between(r, 560, 625), between(r, 1.1, 1.4), p.ink, r() * 6);
  for (let i = 0; i < 2; i++) s += jasmineString(between(r, 960, 990) + i * 40, 110, between(r, 160, 240), p.ink, r);
  return s;
};

export const newYear: Design[] = [balloons, partyHats];
export const republicDay: Design[] = [flagParade, gate];
export const independenceDay: Design[] = [kites, balloonBunch];
export const gandhiJayanti: Design[] = [charkha, spectacles];
export const rajyotsava: Design[] = [palace, elephantDay];
