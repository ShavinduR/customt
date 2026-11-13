/**
 * Single source of truth for garment shapes, shared by:
 *  - the 2D SVG preview (TShirtPreview)
 *  - the 3D texture painter (designTexture.js)
 *  - the .glb model generator (scripts/build-garment-models.mjs)
 *
 * Coordinates are in a 400 x 460 design space (front view, y down). The 3D models use the same
 * outline, so a point drawn here lands on the same spot of the 3D garment.
 */

export const VIEW_W = 400;
export const VIEW_H = 460;

export const BODY = {
  'Crew Neck':
    'M128 42 C145 34 158 30 166 28 C178 46 222 46 234 28 C242 30 255 34 272 42 L352 84 C356 86 357 90 355 94 L328 156 C326 160 322 161 318 159 L298 149 L300 418 C300 424 296 428 290 428 L110 428 C104 428 100 424 100 418 L102 149 L82 159 C78 161 74 160 72 156 L45 94 C43 90 44 86 48 84 Z',
  Polo:
    'M128 42 C145 34 158 30 166 28 C178 46 222 46 234 28 C242 30 255 34 272 42 L346 80 C350 82 352 86 350 90 L330 140 C328 144 324 146 320 144 L298 136 L300 418 C300 424 296 428 290 428 L110 428 C104 428 100 424 100 418 L102 136 L80 144 C76 146 72 144 70 140 L50 90 C48 86 50 82 54 80 Z',
  Hoodie:
    'M126 46 C146 38 158 34 166 32 C178 48 222 48 234 32 C242 34 254 38 274 46 L338 76 C350 82 356 92 358 104 L378 372 C379 380 374 386 366 387 L338 390 C330 391 324 386 323 378 L302 176 L304 420 C304 426 300 430 294 430 L106 430 C100 430 96 426 96 420 L98 176 L77 378 C76 386 70 391 62 390 L34 387 C26 386 21 380 22 372 L42 104 C44 92 50 82 62 76 Z',
};

/**
 * Indices of the outline segments that are openings (neck, cuffs, hem), counted per drawing command
 * after the initial M. The 3D generator leaves these open so the garment is a tube, not a pillow.
 */
export const OPEN_SEGMENTS = {
  'Crew Neck': [1, 5, 10, 15],
  Polo: [1, 5, 10, 15],
  Hoodie: [1, 7, 12, 17],
};

export const SIDES = ['front', 'back', 'leftSleeve', 'rightSleeve'];
export const SIDE_LABEL = { front: 'Front', back: 'Back', leftSleeve: 'Left sleeve', rightSleeve: 'Right sleeve' };

/**
 * Printable areas: centre, size and rotation (degrees, clockwise). Layer positions are percentages of
 * the area's own (rotated) width and height. Sleeves are the wearer's sleeves: the wearer's LEFT sleeve
 * appears on the viewer's RIGHT in the front view. Sleeve prints sit on the front face of the sleeve.
 */
export const PRINT_AREAS = {
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
};

/** Which flat view a side is drawn on (sleeve prints live on the front face). */
export const SIDE_FACE = { front: 'front', back: 'back', leftSleeve: 'front', rightSleeve: 'front' };

/**
 * Construction details drawn over the base colour. Colours are brightness shifts of the base colour
 * (percent), so they suit any garment colour. Used by the SVG preview and the 3D texture.
 */
const circle = (cx, cy, r) => `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy} Z`;

export const DETAILS = {
  'Crew Neck': {
    both: [
      { d: 'M102 149 C112 110 120 70 128 42 M298 149 C288 110 280 70 272 42', stroke: -18, width: 1.2 },
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
      { d: 'M102 136 C110 100 118 68 128 42 M298 136 C290 100 282 68 272 42', stroke: -18, width: 1.2 },
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
      { d: 'M98 176 C104 130 112 80 126 46 M302 176 C296 130 288 80 274 46', stroke: -18, width: 1.2 },
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
};

export const detailsFor = (garment, face) => [...(DETAILS[garment]?.both || []), ...(DETAILS[garment]?.[face] || [])];

/** Garment model files (generated by scripts/build-garment-models.mjs into public/models). */
export const MODEL_FILE = { 'Crew Neck': '/models/crew-neck.glb', Polo: '/models/polo.glb', Hoodie: '/models/hoodie.glb' };

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
