/**
 * Single source of truth for garment shapes, shared by:
 *  - the 2D SVG preview (TShirtPreview)
 *  - the 3D texture painter (designTexture.js)
 *  - the .glb model generator (scripts/build-garment-models.mjs)
 *
 * Coordinates are in a 400 x 460 design space (front view, y down). The 3D models use the same
 * outline, so a point drawn here lands on the same spot of the 3D garment.
 */

/**
 * Real proportions. The outlines below were first drawn in a 400-unit-wide space ("raw" coordinates,
 * centre x = 200) at about half the width of a real garment. They are widened by KX about the centre into
 * the real design space, where UNITS_PER_CM converts to centimetres: the size-M T-shirt becomes
 * ~53 cm wide (chest) x ~73 cm long (high point of shoulder to hem), like a standard size chart.
 */
export const KX = 1.5;
export const VIEW_W = 620;
export const VIEW_H = 460;
export const UNITS_PER_CM = 5.5;
const RAW_CX = 200;
/** Height (y) of the high point of the shoulder (where the neck meets the shoulder) per garment. */
export const HPS_Y = { 'Crew Neck': 28, Polo: 28, Hoodie: 32, 'Short Sleeve Shirt': 28, 'Long Sleeve Shirt': 28 };
const tx = (x) => VIEW_W / 2 + (x - RAW_CX) * KX;
const round2 = (v) => Math.round(v * 100) / 100;

/** Applies the raw → real transform to an absolute SVG path (M L C Q H V A Z). Arc radii are kept. */
function transformPath(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g);
  const out = [];
  let i = 0;
  let cmd = null;
  const n = () => Number(tokens[i++]);
  const xy = () => out.push(round2(tx(n())), round2(n()));
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i++];
      out.push(cmd);
      if (cmd === 'Z') continue;
    }
    if (cmd === 'M' || cmd === 'L') xy();
    else if (cmd === 'C') { xy(); xy(); xy(); }
    else if (cmd === 'Q') { xy(); xy(); }
    else if (cmd === 'H') out.push(round2(tx(n())));
    else if (cmd === 'V') out.push(round2(n()));
    else if (cmd === 'A') { out.push(n(), n(), n(), n(), n()); xy(); }
    else throw new Error(`Unsupported path command ${cmd}`);
  }
  return out.join(' ');
}
const mapObject = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v, k)]));

const RAW_BODY = {
  'Crew Neck':
    'M128 42 C145 34 158 30 166 28 C178 46 222 46 234 28 C242 30 255 34 272 42 L352 84 C356 86 357 90 355 94 L328 156 C326 160 322 161 318 159 L298 149 L300 418 C300 424 296 428 290 428 L110 428 C104 428 100 424 100 418 L102 149 L82 159 C78 161 74 160 72 156 L45 94 C43 90 44 86 48 84 Z',
  Polo:
    'M128 42 C145 34 158 30 166 28 C178 46 222 46 234 28 C242 30 255 34 272 42 L346 80 C350 82 352 86 350 90 L330 140 C328 144 324 146 320 144 L298 136 L300 418 C300 424 296 428 290 428 L110 428 C104 428 100 424 100 418 L102 136 L80 144 C76 146 72 144 70 140 L50 90 C48 86 50 82 54 80 Z',
  Hoodie:
    'M126 46 C146 38 158 34 166 32 C178 48 222 48 234 32 C242 34 254 38 274 46 L338 76 C350 82 356 92 358 104 L378 372 C379 380 374 386 366 387 L338 390 C330 391 324 386 323 378 L302 176 L304 420 C304 426 300 430 294 430 L106 430 C100 430 96 426 96 420 L98 176 L77 378 C76 386 70 391 62 390 L34 387 C26 386 21 380 22 372 L42 104 C44 92 50 82 62 76 Z',
  // Button-up shirts: straight body with a curved shirt-tail hem (longer at the centre than at the sides).
  'Short Sleeve Shirt':
    'M128 42 C145 34 158 30 166 28 C178 46 222 46 234 28 C242 30 255 34 272 42 L354 88 C358 90 360 94 358 98 L334 166 C332 170 328 171 324 169 L298 152 L300 400 C300 404 298 408 294 410 C250 438 150 438 106 410 C102 408 100 404 100 400 L102 152 L76 169 C72 171 68 170 66 166 L42 98 C40 94 42 90 46 88 Z',
  'Long Sleeve Shirt':
    'M128 42 C145 34 158 30 166 28 C178 46 222 46 234 28 C242 30 255 34 272 42 L334 72 C346 78 352 88 354 100 L372 368 C373 376 368 382 360 383 L334 386 C326 387 320 382 319 374 L300 168 L300 400 C300 404 298 408 294 410 C250 438 150 438 106 410 C102 408 100 404 100 400 L100 168 L81 374 C80 382 74 387 66 386 L40 383 C32 382 27 376 28 368 L46 100 C48 88 54 78 66 72 Z',
};

export const BODY = mapObject(RAW_BODY, transformPath);

/**
 * Indices of the outline segments that are openings (neck, cuffs, hem), counted per drawing command
 * after the initial M. The 3D generator leaves these open so the garment is a tube, not a pillow.
 */
export const OPEN_SEGMENTS = {
  'Crew Neck': [1, 5, 10, 15],
  Polo: [1, 5, 10, 15],
  Hoodie: [1, 7, 12, 17],
  'Short Sleeve Shirt': [1, 5, 10, 15],
  'Long Sleeve Shirt': [1, 7, 12, 17],
};

export const SIDES = ['front', 'back', 'leftSleeve', 'rightSleeve'];
export const SIDE_LABEL = { front: 'Front', back: 'Back', leftSleeve: 'Left sleeve', rightSleeve: 'Right sleeve' };

/**
 * Printable areas: centre, size and rotation (degrees, clockwise). Layer positions are percentages of
 * the area's own (rotated) width and height. Sleeves are the wearer's sleeves: the wearer's LEFT sleeve
 * appears on the viewer's RIGHT in the front view. Sleeve prints sit on the front face of the sleeve.
 */
const RAW_PRINT_AREAS = {
  'Crew Neck': {
    front: { cx: 200, cy: 205, w: 130, h: 250, rotate: 0 },
    back: { cx: 200, cy: 205, w: 140, h: 280, rotate: 0 },
    leftSleeve: { cx: 318, cy: 110, w: 44, h: 30, rotate: 28 },
    rightSleeve: { cx: 82, cy: 110, w: 44, h: 30, rotate: -28 },
  },
  Polo: {
    front: { cx: 200, cy: 235, w: 136, h: 190, rotate: 0 },
    back: { cx: 200, cy: 210, w: 140, h: 280, rotate: 0 },
    leftSleeve: { cx: 312, cy: 100, w: 38, h: 28, rotate: 26 },
    rightSleeve: { cx: 88, cy: 100, w: 38, h: 28, rotate: -26 },
  },
  Hoodie: {
    front: { cx: 200, cy: 225, w: 124, h: 180, rotate: 0 },
    back: { cx: 200, cy: 250, w: 140, h: 220, rotate: 0 },
    leftSleeve: { cx: 338, cy: 175, w: 90, h: 32, rotate: 84 },
    rightSleeve: { cx: 62, cy: 175, w: 90, h: 32, rotate: -84 },
  },
  'Short Sleeve Shirt': {
    front: { cx: 200, cy: 215, w: 136, h: 200, rotate: 0 },
    back: { cx: 200, cy: 235, w: 140, h: 250, rotate: 0 },
    leftSleeve: { cx: 320, cy: 114, w: 42, h: 30, rotate: 28 },
    rightSleeve: { cx: 80, cy: 114, w: 42, h: 30, rotate: -28 },
  },
  'Long Sleeve Shirt': {
    front: { cx: 200, cy: 215, w: 136, h: 200, rotate: 0 },
    back: { cx: 200, cy: 235, w: 140, h: 250, rotate: 0 },
    leftSleeve: { cx: 334, cy: 215, w: 110, h: 34, rotate: 85 },
    rightSleeve: { cx: 66, cy: 215, w: 110, h: 34, rotate: -85 },
  },
};

/** Moves a rotated raw print area into the real space (rotation and size follow the widening). */
function transformArea(a) {
  const rad = (a.rotate * Math.PI) / 180;
  const ux = Math.cos(rad) * KX;
  const uy = Math.sin(rad);
  const su = Math.hypot(ux, uy);
  return { cx: round2(tx(a.cx)), cy: a.cy, w: round2(a.w * su), h: round2((a.h * KX) / su), rotate: round2((Math.atan2(uy, ux) * 180) / Math.PI) };
}
/** Body print areas in centimetres (standard maximum print sizes), centred on the garment. */
const bodyArea = (cy, wCm, hCm) => ({ cx: VIEW_W / 2, cy, w: wCm * UNITS_PER_CM, h: hCm * UNITS_PER_CM, rotate: 0 });
const BODY_AREAS = {
  'Crew Neck': { front: bodyArea(205, 30, 40), back: bodyArea(205, 30, 40) },
  // Polo and hoodie fronts start at chest height, so a left-chest logo fits (hoodie ends above the pocket).
  Polo: { front: bodyArea(205, 30, 40), back: bodyArea(210, 30, 40) },
  Hoodie: { front: bodyArea(198, 30, 38), back: bodyArea(250, 32, 36) },
  'Short Sleeve Shirt': { front: bodyArea(215, 28, 36), back: bodyArea(240, 30, 40) },
  'Long Sleeve Shirt': { front: bodyArea(215, 28, 36), back: bodyArea(240, 30, 40) },
};
export const PRINT_AREAS = mapObject(RAW_PRINT_AREAS, (areas, garment) => ({
  ...BODY_AREAS[garment],
  leftSleeve: transformArea(areas.leftSleeve),
  rightSleeve: transformArea(areas.rightSleeve),
}));

/**
 * Pattern (cut-piece) geometry, for the image-RIGHT half of each garment (the wearer's left sleeve);
 * the left half is its mirror image.
 *  ARMHOLE:     armhole seam as a cubic [shoulder point, control 1, control 2, armpit]. It separates
 *               the sleeve from the body (same curve as the seam drawn in DETAILS).
 *  HEM_CORNER:  bottom corner of the body side seam; below the armpit the body ends at that line.
 *  SLEEVE_FOLD: straight outer edge of the sleeve [top, bottom]. On the flat garment, the front and back
 *               halves of a sleeve meet along it, so the unfolded sleeve piece is mirrored about this line.
 */

const RAW_HEM_CORNER = {
  'Crew Neck': [300, 418],
  Polo: [300, 418],
  Hoodie: [304, 420],
  'Short Sleeve Shirt': [300, 400],
  'Long Sleeve Shirt': [300, 400],
};
const RAW_SLEEVE_FOLD = {
  'Crew Neck': [[272, 42], [352, 84]],
  Polo: [[272, 42], [346, 80]],
  Hoodie: [[358, 104], [378, 372]],
  'Short Sleeve Shirt': [[272, 42], [354, 88]],
  'Long Sleeve Shirt': [[354, 100], [372, 368]],
};
const txPt = ([x, y]) => [round2(tx(x)), y];
export const HEM_CORNER = mapObject(RAW_HEM_CORNER, txPt);
export const SLEEVE_FOLD = mapObject(RAW_SLEEVE_FOLD, (line) => line.map(txPt));
const RAW_ARMPIT = {
  'Crew Neck': [298, 149],
  Polo: [298, 136],
  Hoodie: [302, 176],
  'Short Sleeve Shirt': [298, 152],
  'Long Sleeve Shirt': [300, 168],
};
/**
 * Armhole seam from the top of the sleeve fold to the armpit. For set-in short sleeves it leaves the fold at
 * a right angle, so the unfolded sleeve piece gets a rounded cap (as on a real sleeve pattern), then scoops
 * down to the armpit.
 */
/**
 * Long, hanging sleeves (hoodie, long sleeve shirt) keep their drawn seam from the shoulder point: their
 * sleeves hang close to the body, so a right-angle cap would push the shoulder into the body piece.
 */
const RAW_HANGING_ARMHOLE = {
  Hoodie: [[274, 46], [288, 80], [296, 130], [302, 176]],
  'Long Sleeve Shirt': [[272, 42], [284, 76], [292, 120], [300, 168]],
};
export const ARMHOLE = mapObject(SLEEVE_FOLD, ([top, bottom], garment) => {
  if (RAW_HANGING_ARMHOLE[garment]) return RAW_HANGING_ARMHOLE[garment].map(txPt);
  const ap = txPt(RAW_ARMPIT[garment]);
  const len = Math.hypot(bottom[0] - top[0], bottom[1] - top[1]);
  const u = [(bottom[0] - top[0]) / len, (bottom[1] - top[1]) / len];
  let nrm = [-u[1], u[0]];
  if ((ap[0] - top[0]) * nrm[0] + (ap[1] - top[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
  const d = Math.hypot(ap[0] - top[0], ap[1] - top[1]);
  const c1 = [round2(top[0] + 0.4 * d * nrm[0]), round2(top[1] + 0.4 * d * nrm[1])];
  const c2 = [round2(ap[0] - 0.15 * d), round2(ap[1] - 0.35 * d)];
  return [top, c1, c2, ap];
});
const armholeSeam = (g) => {
  const [p0, c1, c2, p3] = ARMHOLE[g];
  const m = ([x, y]) => `${round2(VIEW_W - x)} ${y}`;
  const q = ([x, y]) => `${x} ${y}`;
  return `M${q(p0)} C${q(c1)} ${q(c2)} ${q(p3)} M${m(p0)} C${m(c1)} ${m(c2)} ${m(p3)}`;
};

/** Which flat view a side is drawn on (sleeve prints live on the front face). */
export const SIDE_FACE = { front: 'front', back: 'back', leftSleeve: 'front', rightSleeve: 'front' };

/**
 * Construction details drawn over the base colour. Colours are brightness shifts of the base colour
 * (percent), so they suit any garment colour. Used by the SVG preview and the 3D texture.
 */
// Horizontal half-width is pre-divided by KX so buttons stay round after the widening.
const circle = (cx, cy, r) => `M${cx + r / KX} ${cy} A${r} ${r} 0 1 1 ${cx - r / KX} ${cy} A${r} ${r} 0 1 1 ${cx + r / KX} ${cy} Z`;

const RAW_DETAILS = {
  'Crew Neck': {
    both: [
      { d: 'M100 412 L300 412', stroke: -18, width: 1, dash: [4, 3] },
      { d: 'M78 150 L52 98 M322 150 L348 98', stroke: -18, width: 1, dash: [3, 3] },
    ],
    front: [
      { d: 'M166 28 C178 58 222 58 234 28 C222 36 178 36 166 28 Z', fill: -42 },
      { d: 'M166 28 C178 58 222 58 234 28', stroke: -28, width: 6, cap: 'round' },
    ],
    back: [{ d: 'M166 28 C180 40 220 40 234 28', stroke: -28, width: 6, cap: 'round' }],
  },
  Polo: {
    both: [
      { d: 'M320 144 L298 136 M80 144 L102 136', stroke: -28, width: 1.2 },
      { d: 'M100 412 L300 412', stroke: -18, width: 1, dash: [4, 3] },
    ],
    front: [
      { d: 'M166 28 C178 46 222 46 234 28 C222 34 178 34 166 28 Z', fill: -42 },
      { d: 'M194 44 H206 Q209 44 209 47 V125 Q209 128 206 128 H194 Q191 128 191 125 V47 Q191 44 194 44 Z', fill: -6, stroke: -28, width: 1.2 },
      { d: `${circle(200, 66, 3.2)} ${circle(200, 88, 3.2)} ${circle(200, 110, 3.2)}`, fill: 25, stroke: -28, width: 0.8 },
      { d: 'M166 28 L148 60 L194 76 L200 46 Z', fill: -4, stroke: -28, width: 1.4, join: 'round' },
      { d: 'M234 28 L252 60 L206 76 L200 46 Z', fill: -4, stroke: -28, width: 1.4, join: 'round' },
    ],
    back: [{ d: 'M160 24 C180 16 220 16 240 24 L246 42 C228 34 172 34 154 42 Z', fill: -8, stroke: -28, width: 1.4 }],
  },
  Hoodie: {
    both: [
      { d: 'M322 366 L377 360 L378 372 C379 380 374 386 366 387 L338 390 C330 391 324 386 323 378 Z', fill: -10 },
      { d: 'M78 366 L23 360 L22 372 C21 380 26 386 34 387 L62 390 C70 391 76 386 77 378 Z', fill: -10 },
      { d: 'M96 404 L304 404 L304 420 C304 426 300 430 294 430 L106 430 C100 430 96 426 96 420 Z', fill: -10 },
    ],
    front: [
      { d: 'M132 322 L268 322 L290 396 L110 396 Z', stroke: -28, width: 2 },
      { d: 'M138 328 L262 328', stroke: -18, width: 1, dash: [3, 3] },
      { d: 'M150 40 C150 0 250 0 250 40 C246 62 226 74 200 76 C174 74 154 62 150 40 Z', fill: -12, stroke: -28, width: 1.5 },
      { d: 'M165 38 C168 14 232 14 235 38 C230 54 216 62 200 62 C184 62 170 54 165 38 Z', fill: -42 },
    ],
    back: [
      { d: 'M146 44 C146 0 254 0 254 44 L244 120 C230 132 170 132 156 120 Z', fill: -6, stroke: -28, width: 1.5 },
      { d: 'M200 6 L200 128', stroke: -18, width: 1.2 },
    ],
  },
  'Short Sleeve Shirt': {
    both: [
      { d: 'M350 100 L328 160 M50 100 L72 160', stroke: -18, width: 1, dash: [3, 3] },
      { d: 'M104 403 C150 430 250 430 296 403', stroke: -18, width: 1, dash: [4, 3] },
    ],
    front: [
      { d: 'M166 28 C178 46 222 46 234 28 C222 34 178 34 166 28 Z', fill: -42 },
      { d: 'M194 46 H206 V430 H194 Z', fill: -4, stroke: -24, width: 1 },
      { d: `${[72, 122, 172, 222, 272, 322, 372].map((y) => circle(200, y, 3)).join(' ')}`, fill: 22, stroke: -30, width: 0.8 },
      { d: 'M228 118 H270 V166 L249 174 L228 166 Z', fill: -3, stroke: -26, width: 1.3, join: 'round' },
      { d: 'M228 124 H270', stroke: -18, width: 0.8, dash: [3, 2] },
      { d: 'M166 28 L146 64 L196 80 L200 46 Z', fill: -4, stroke: -28, width: 1.4, join: 'round' },
      { d: 'M234 28 L254 64 L204 80 L200 46 Z', fill: -4, stroke: -28, width: 1.4, join: 'round' },
    ],
    back: [
      { d: 'M160 24 C180 16 220 16 240 24 L246 42 C228 34 172 34 154 42 Z', fill: -8, stroke: -28, width: 1.4 },
      { d: 'M130 82 C170 92 230 92 270 82', stroke: -20, width: 1.2 },
      { d: 'M200 89 L200 116', stroke: -18, width: 1 },
    ],
  },
  'Long Sleeve Shirt': {
    both: [
      { d: 'M370 340 L372 368 C373 376 368 382 360 383 L334 386 C326 387 320 382 319 374 L316.5 346 Z', fill: -8, stroke: -26, width: 1 },
      { d: 'M30 340 L28 368 C27 376 32 382 40 383 L66 386 C74 387 80 382 81 374 L83.5 346 Z', fill: -8, stroke: -26, width: 1 },
      { d: `${circle(356, 364, 2.6)} ${circle(44, 364, 2.6)}`, fill: 22, stroke: -30, width: 0.8 },
      { d: 'M104 403 C150 430 250 430 296 403', stroke: -18, width: 1, dash: [4, 3] },
    ],
    front: [
      { d: 'M166 28 C178 46 222 46 234 28 C222 34 178 34 166 28 Z', fill: -42 },
      { d: 'M194 46 H206 V430 H194 Z', fill: -4, stroke: -24, width: 1 },
      { d: `${[72, 122, 172, 222, 272, 322, 372].map((y) => circle(200, y, 3)).join(' ')}`, fill: 22, stroke: -30, width: 0.8 },
      { d: 'M228 118 H270 V166 L249 174 L228 166 Z', fill: -3, stroke: -26, width: 1.3, join: 'round' },
      { d: 'M228 124 H270', stroke: -18, width: 0.8, dash: [3, 2] },
      { d: 'M166 28 L146 64 L196 80 L200 46 Z', fill: -4, stroke: -28, width: 1.4, join: 'round' },
      { d: 'M234 28 L254 64 L204 80 L200 46 Z', fill: -4, stroke: -28, width: 1.4, join: 'round' },
    ],
    back: [
      { d: 'M160 24 C180 16 220 16 240 24 L246 42 C228 34 172 34 154 42 Z', fill: -8, stroke: -28, width: 1.4 },
      { d: 'M130 82 C170 92 230 92 270 82', stroke: -20, width: 1.2 },
      { d: 'M200 89 L200 116', stroke: -18, width: 1 },
    ],
  },
};

// Real-space details: every raw path widened, plus the armhole seams generated from ARMHOLE.
export const DETAILS = mapObject(RAW_DETAILS, (faces, garment) => ({
  ...mapObject(faces, (list) => list.map((d) => ({ ...d, d: transformPath(d.d) }))),
  both: [{ d: armholeSeam(garment), stroke: -18, width: 1.2 }, ...(faces.both || []).map((d) => ({ ...d, d: transformPath(d.d) }))],
}));

export const detailsFor = (garment, face) => [...(DETAILS[garment]?.both || []), ...(DETAILS[garment]?.[face] || [])];

/** Garment model files (generated by scripts/build-garment-models.mjs into public/models). */
export const MODEL_FILE = {
  'Crew Neck': '/models/crew-neck.glb',
  Polo: '/models/polo.glb',
  Hoodie: '/models/hoodie.glb',
  'Short Sleeve Shirt': '/models/short-sleeve-shirt.glb',
  'Long Sleeve Shirt': '/models/long-sleeve-shirt.glb',
};

/** Adjusts a hex colour's brightness by percent (-100..100). */
export function shade(hex = '#FFFFFF', percent = 0) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  const amt = Math.round(2.55 * percent);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
