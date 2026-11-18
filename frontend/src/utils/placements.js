/**
 * Placement presets: the standard print positions printers use, in real centimetres.
 *
 * x: offset of the artwork's centre from the garment's centre line (+ = wearer's LEFT, i.e. the viewer's
 *    right on the front), y: distance of the centre below the high point of the shoulder (HPS),
 * width: printed width. Missing x/y = centre of that side's print area (sleeves, full front/back).
 * Applying a preset moves the layer to the side and position, and sizes it to the width.
 */
import { HPS_Y, PRINT_AREAS, UNITS_PER_CM, VIEW_W } from './garmentGeometry.js';
import { LIMITS, textExtent } from './design.js';

const CHEST = [
  { id: 'left-chest', label: 'Left chest', hint: 'Logo over the heart', side: 'front', x: 9.5, y: 20, width: 9 },
  { id: 'right-chest', label: 'Right chest', hint: 'Logo on the right', side: 'front', x: -9.5, y: 20, width: 9 },
];
// Button-up shirts: the left chest logo goes on the pocket (its centre, from the pocket drawn in DETAILS).
const POCKET = [{ id: 'pocket', label: 'Pocket logo', hint: 'On the chest pocket', side: 'front', x: 13.3, y: 21.5, width: 7 }];

const COMMON = [
  { id: 'centre-chest', label: 'Centre chest', hint: 'Mid-size, across the chest', side: 'front', x: 0, y: 22, width: 25 },
  { id: 'full-front', label: 'Full front', hint: 'Largest front print', side: 'front', width: 30 },
  { id: 'upper-back', label: 'Upper back', hint: 'Name or slogan under the collar', side: 'back', x: 0, top: true, width: 28 },
  { id: 'full-back', label: 'Full back', hint: 'Largest back print', side: 'back', width: 30 },
  { id: 'left-sleeve', label: 'Left sleeve', hint: 'Small logo or number', side: 'leftSleeve', width: 7 },
  { id: 'right-sleeve', label: 'Right sleeve', hint: 'Small logo or number', side: 'rightSleeve', width: 7 },
];

export const PLACEMENT_GROUPS = [
  { side: 'front', label: 'Front' },
  { side: 'back', label: 'Back' },
  { side: 'sleeves', label: 'Sleeves' },
];

const isShirt = (g) => g === 'Short Sleeve Shirt' || g === 'Long Sleeve Shirt';

/** The presets offered for a garment, each with its print width clipped to the side's print area. */
export function placementsFor(garment) {
  const areas = PRINT_AREAS[garment] || PRINT_AREAS['Crew Neck'];
  return [...(isShirt(garment) ? POCKET : CHEST), ...COMMON].map((p) => ({
    ...p,
    group: p.side === 'leftSleeve' || p.side === 'rightSleeve' ? 'sleeves' : p.side,
    width: Math.min(p.width, Math.floor(areas[p.side].w / UNITS_PER_CM)),
  }));
}

const clampPct = (v) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));

/**
 * The layer patch that puts `layer` at `preset` on `garment`: side, x/y (% of the print area), rotation 0,
 * and its size (image `scale` or text `size`) so the printed width matches the preset.
 */
export function applyPlacement(layer, preset, garment) {
  const g = PRINT_AREAS[garment] ? garment : 'Crew Neck';
  const area = PRINT_AREAS[g][preset.side];
  const widthUnits = preset.width * UNITS_PER_CM;
  let x = 50;
  let y = 50;
  if (preset.x !== undefined && area.rotate === 0) {
    const px = VIEW_W / 2 + preset.x * UNITS_PER_CM;
    x = ((px - (area.cx - area.w / 2)) / area.w) * 100;
  }
  if (preset.top && area.rotate === 0) y = 12; // just under the top edge of the back print area
  else if (preset.y !== undefined && area.rotate === 0) {
    const py = HPS_Y[g] + preset.y * UNITS_PER_CM;
    y = ((py - (area.cy - area.h / 2)) / area.h) * 100;
  }
  const patch = { side: preset.side, x: clampPct(x), y: clampPct(y), rotation: 0 };
  if (layer.kind === 'image' || layer.url) {
    patch.scale = Math.round(Math.max(LIMITS.scaleMin, Math.min(LIMITS.scaleMax, widthUnits / area.w)) * 100) / 100;
  } else {
    // Text width scales with the font size, so measure it once and scale to the preset width.
    const { w } = textExtent({ ...layer, size: 100 });
    patch.size = Math.round(Math.max(LIMITS.sizeMin, Math.min(LIMITS.sizeMax, (widthUnits / w) * 100)));
  }
  return patch;
}
