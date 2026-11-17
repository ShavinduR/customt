/**
 * Real-size helpers. Design-space units convert to centimetres with UNITS_PER_CM (garmentGeometry.js);
 * the studio can show centimetres or inches.
 */
import { UNITS_PER_CM } from './garmentGeometry.js';

export const UNITS = ['cm', 'in'];
const PER_UNIT = { cm: UNITS_PER_CM, in: UNITS_PER_CM * 2.54 };

/** Converts design units to the display unit. */
export const toUnit = (units, unit = 'cm') => units / PER_UNIT[unit];
/** Design units per one display unit (cm or inch). */
export const unitsPer = (unit = 'cm') => PER_UNIT[unit];

/** "12.4 cm" / "4.9 in" (one decimal, trailing .0 dropped). */
export function formatLength(units, unit = 'cm') {
  const v = Math.round(toUnit(units, unit) * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`;
}
/** "30 × 40 cm" */
export function formatSize(w, h, unit = 'cm') {
  const f = (u) => {
    const v = Math.round(toUnit(u, unit) * 10) / 10;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };
  return `${f(w)} × ${f(h)} ${unit}`;
}
