/**
 * Cut-piece ("sewing pattern") layout of a garment for the 2D editor.
 *
 * The design itself is unchanged: layers still live on the garment's front/back faces (the same data the
 * 3D model is painted from). This module only says how to cut those faces into pieces and lay them flat:
 *
 *   Front piece  = front face, body only (between the two armhole seams)
 *   Back piece   = back face, body only
 *   Sleeve piece = the sleeve's front half (from the front face) + its back half (from the back face),
 *                  unfolded about the sleeve's outer fold line so the cap is at the top and the cuff at
 *                  the bottom, like a real sleeve pattern.
 *
 * Every half is an affine map (SVG matrix) from face coordinates to layout coordinates, so the editor can
 * draw it with a transform and drag maths keeps working through getScreenCTM().
 * Affine maps are [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG matrix order).
 */
import { ARMHOLE, BODY, HEM_CORNER, SLEEVE_FOLD, VIEW_W } from './garmentGeometry.js';

const IDENTITY = [1, 0, 0, 1, 0, 0];
const MIRROR = [-1, 0, 0, 1, VIEW_W, 0]; // left ↔ right half of a face
const FLIP = [-1, 0, 0, 1, 0, 0]; // mirror a piece about its own fold (x = 0)
const translate = (x, y) => [1, 0, 0, 1, x, y];

export const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** compose(m1, m2): apply m2 first, then m1. */
export const compose = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
export const toSvgMatrix = (m) => `matrix(${m.map((v) => Math.round(v * 10000) / 10000).join(' ')})`;

const mirrorPt = ([x, y]) => [VIEW_W - x, y];
const pt = ([x, y]) => `${x} ${y}`;

function cubicPoints(p0, c1, c2, p3, steps = 24) {
  const out = [];
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    const mt = 1 - t;
    out.push([
      mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p3[0],
      mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p3[1],
    ]);
  }
  return out;
}

/** Samples an absolute M/L/C/Z path (the BODY outlines) into a polygon. */
function samplePath(d) {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+/g);
  const points = [];
  let i = 0;
  let cur = null;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'L') {
      const p = [num(), num()];
      if (cmd === 'L' && cur) for (let k = 1; k <= 8; k += 1) points.push([cur[0] + ((p[0] - cur[0]) * k) / 8, cur[1] + ((p[1] - cur[1]) * k) / 8]);
      else points.push(p);
      cur = p;
    } else if (cmd === 'C') {
      const c1 = [num(), num()];
      const c2 = [num(), num()];
      const p = [num(), num()];
      points.push(...cubicPoints(cur, c1, c2, p, 12).slice(1));
      cur = p;
    }
  }
  return points;
}

function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Clip regions in face coordinates: `body` (between the armholes), `right` / `left` (the sleeve sides).
 * Paths are for SVG clipPaths; polygons are for measuring the pieces.
 */
export function patternRegions(garment) {
  const [A, c1, c2, P] = ARMHOLE[garment];
  const H = HEM_CORNER[garment];
  const [mA, mc1, mc2, mP, mH] = [A, c1, c2, P, H].map(mirrorPt);
  const FAR = 2000;
  const paths = {
    right: `M${A[0]} ${-FAR} L${pt(A)} C${pt(c1)} ${pt(c2)} ${pt(P)} L${pt(H)} L${H[0]} ${FAR} L${FAR} ${FAR} L${FAR} ${-FAR} Z`,
    left: `M${mA[0]} ${-FAR} L${pt(mA)} C${pt(mc1)} ${pt(mc2)} ${pt(mP)} L${pt(mH)} L${mH[0]} ${FAR} L${-FAR} ${FAR} L${-FAR} ${-FAR} Z`,
    body: `M${mA[0]} ${-FAR} L${A[0]} ${-FAR} L${pt(A)} C${pt(c1)} ${pt(c2)} ${pt(P)} L${pt(H)} L${H[0]} ${FAR} L${mH[0]} ${FAR} L${pt(mH)} L${pt(mP)} C${pt(mc2)} ${pt(mc1)} ${pt(mA)} Z`,
  };
  const curveR = cubicPoints(A, c1, c2, P);
  const curveL = curveR.map(mirrorPt);
  // Measuring polygons: the seam is nudged 1.5 units into the sleeve so points ON the side seam count as
  // body (otherwise the whole side seam would be measured as part of the sleeve).
  const NUDGE = 1.5;
  const bR = [A, ...curveR, H].map(([x, y]) => [x + NUDGE, y]);
  const bL = bR.map(mirrorPt);
  const polys = {
    right: [[bR[0][0], -FAR], ...bR, [bR[bR.length - 1][0], FAR], [FAR, FAR], [FAR, -FAR]],
    left: [[bL[0][0], -FAR], ...bL, [bL[bL.length - 1][0], FAR], [-FAR, FAR], [-FAR, -FAR]],
    body: [[bL[0][0], -FAR], [bR[0][0], -FAR], ...bR, [bR[bR.length - 1][0], FAR], [bL[bL.length - 1][0], FAR], ...[...bL].reverse()],
  };
  // Cut lines along the armholes (drawn on top of each piece; the clip keeps the half that belongs to it).
  const cutLines = {
    right: `M${pt(A)} C${pt(c1)} ${pt(c2)} ${pt(P)} L${pt(H)}`,
    left: `M${pt(mA)} C${pt(mc1)} ${pt(mc2)} ${pt(mP)} L${pt(mH)}`,
  };
  cutLines.body = `${cutLines.right} ${cutLines.left}`;
  return { paths, polys, cutLines, curves: { right: curveR, left: curveL, body: [...curveR, ...curveL] } };
}

/** Frame of the unfolded sleeve: fold line → x = 0 (cap up), front half at x < 0. */
function sleeveFrame(garment) {
  const [A, B] = SLEEVE_FOLD[garment];
  const P = ARMHOLE[garment][3];
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
  let n = [-u[1], u[0]];
  if ((P[0] - A[0]) * n[0] + (P[1] - A[1]) * n[1] < 0) n = [-n[0], -n[1]]; // n points into the sleeve
  const nA = n[0] * A[0] + n[1] * A[1];
  const uA = u[0] * A[0] + u[1] * A[1];
  // x' = -n·(p - A), y' = u·(p - A)
  return [-n[0], u[0], -n[1], u[1], nA, -uA];
}

const GAP = 44;
const LABEL = 40;
const MARGIN = 28;

/**
 * Lays out the four pieces: sleeves on the top row (right sleeve above the front, left sleeve above the
 * back), front and back below. Returns pieces with their halves' layout matrices and the layout size.
 */
export function patternLayout(garment) {
  const g = BODY[garment] ? garment : 'Crew Neck';
  const regions = patternRegions(g);
  const outline = samplePath(BODY[g]);
  const L = sleeveFrame(g);
  const LB = compose(FLIP, compose(L, MIRROR));

  const pieces = [
    { side: 'rightSleeve', label: 'Right sleeve', fold: 0, halves: [{ face: 'front', region: 'left', m: LB, owns: true }, { face: 'back', region: 'right', m: L }] },
    { side: 'leftSleeve', label: 'Left sleeve', fold: 0, halves: [{ face: 'front', region: 'right', m: L, owns: true }, { face: 'back', region: 'left', m: LB }] },
    { side: 'front', label: 'Front', fold: VIEW_W / 2, halves: [{ face: 'front', region: 'body', m: IDENTITY, owns: true }] },
    { side: 'back', label: 'Back', fold: VIEW_W / 2, halves: [{ face: 'back', region: 'body', m: IDENTITY, owns: true }] },
  ];

  for (const piece of pieces) {
    let box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const half of piece.halves) {
      const pts = [...outline.filter((p) => inside(p, regions.polys[half.region])), ...regions.curves[half.region].filter((p) => inside(p, outline))];
      for (const p of pts) {
        const [x, y] = apply(half.m, p);
        box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
      }
    }
    piece.box = { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] };
  }

  const by = Object.fromEntries(pieces.map((p) => [p.side, p]));
  const col = [Math.max(by.rightSleeve.box.w, by.front.box.w), Math.max(by.leftSleeve.box.w, by.back.box.w)];
  const rowH = [Math.max(by.rightSleeve.box.h, by.leftSleeve.box.h), Math.max(by.front.box.h, by.back.box.h)];
  const cellX = [MARGIN, MARGIN + col[0] + GAP];
  const rowY = [MARGIN, MARGIN + rowH[0] + LABEL + GAP];
  const cells = { rightSleeve: [0, 0], leftSleeve: [1, 0], front: [0, 1], back: [1, 1] };

  for (const piece of pieces) {
    const [c, r] = cells[piece.side];
    const dx = cellX[c] + (col[c] - piece.box.w) / 2 - piece.box.x;
    // Sleeves sit on the baseline of the top row; front and back hang from the top of the bottom row.
    const dy = (r === 0 ? rowY[0] + rowH[0] - piece.box.h : rowY[1]) - piece.box.y;
    piece.halves = piece.halves.map((h) => ({ ...h, m: compose(translate(dx, dy), h.m) }));
    piece.foldX = piece.fold + dx;
    piece.rect = { x: piece.box.x + dx, y: piece.box.y + dy, w: piece.box.w, h: piece.box.h };
  }

  return {
    garment: g,
    pieces,
    regions,
    width: MARGIN * 2 + col[0] + GAP + col[1],
    height: rowY[1] + rowH[1] + LABEL + MARGIN,
  };
}
