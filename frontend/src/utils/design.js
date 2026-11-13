/**
 * Layered artwork model shared by the configurator, the 2D preview, the 3D texture and spec summaries.
 *
 * textLayer:  { id, side, text, font, size, color, x, y }   x/y = % of the side's print area
 * imageLayer: { id, side, url, x, y, scale }                scale = width as a fraction of the print area
 * side: 'front' | 'back' | 'leftSleeve' | 'rightSleeve'
 */
import { SIDES } from './garmentGeometry';

export const FONTS = [
  { name: 'Bebas Neue', weight: 400, fallback: 'Impact, "Arial Narrow", sans-serif', label: 'Bebas Neue (bold block)' },
  { name: 'Montserrat', weight: 800, fallback: 'Arial, sans-serif', label: 'Montserrat (heavy sans)' },
  { name: 'Playfair Display', weight: 700, fallback: 'Georgia, serif', label: 'Playfair Display (classic serif)' },
  { name: 'Pacifico', weight: 400, fallback: '"Brush Script MT", cursive', label: 'Pacifico (script)' },
];
const FONT_BY_NAME = Object.fromEntries(FONTS.map((f) => [f.name, f]));

export const fontFamily = (name) => `'${name}', ${(FONT_BY_NAME[name] || FONTS[0]).fallback}`;
export const fontWeight = (name) => (FONT_BY_NAME[name] || FONTS[0]).weight;

export const LIMITS = { maxText: 8, maxImages: 8, textMax: 60, sizeMin: 6, sizeMax: 96, scaleMin: 0.1, scaleMax: 1 };

export const newLayerId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Default text size per side (sleeves are small). */
export const defaultTextSize = (side) => (side === 'leftSleeve' || side === 'rightSleeve' ? 10 : 28);

/**
 * Returns the layers of a design. Older designs (single text + logo) are converted the same way the
 * server converts them, so every screen can treat all RFQs alike.
 */
export function layersOf(specs = {}) {
  if (Array.isArray(specs.textLayers) || Array.isArray(specs.imageLayers)) {
    return { textLayers: specs.textLayers || [], imageLayers: specs.imageLayers || [] };
  }
  const pos = specs.designPosition || {};
  const x = Number.isFinite(pos.x) ? pos.x : 50;
  const y = Number.isFinite(pos.y) ? pos.y : 35;
  const scale = Number.isFinite(pos.scale) ? pos.scale : 1;
  const placement = specs.printPlacement || 'FRONT';
  const customText = (specs.customText || '').trim();
  const backText = (specs.backText || '').trim();
  const logoUrl = (specs.logoUrl || '').trim();
  const color = specs.textColor || '#FFFFFF';
  const textLayers = [];
  const imageLayers = [];
  const addSide = (side, text, withLogo) => {
    if (withLogo && logoUrl) imageLayers.push({ id: `legacy-img-${side}`, side, url: logoUrl, x, y: Math.max(0, y - (text ? 8 : 0)), scale: Math.min(1, 0.7 * scale) });
    if (text) textLayers.push({ id: `legacy-txt-${side}`, side, text, font: 'Bebas Neue', size: Math.round(26 * scale), color, x, y: Math.min(100, y + (withLogo && logoUrl ? 22 : 0)) });
  };
  if (placement === 'BACK') addSide('back', customText || backText, true);
  else {
    addSide('front', customText, true);
    if (placement === 'FRONT_AND_BACK') addSide('back', backText || customText, false);
  }
  return { textLayers, imageLayers };
}

export function printedSides(specs) {
  const { textLayers, imageLayers } = layersOf(specs);
  const used = new Set([...textLayers, ...imageLayers].map((l) => l.side));
  return SIDES.filter((side) => used.has(side));
}

/** Mirrors the server's delivery estimate (one extra day per extra printed side). */
export function estimateDeliveryDays(specs, total, estimation) {
  if (!estimation) return null;
  const base = estimation.basePrintDays[specs.printType] ?? 7;
  const garment = estimation.garmentExtraDays[specs.garmentType] ?? 0;
  const volume = Math.max(0, Math.ceil(total / estimation.piecesPerExtraDay) - 1);
  const sides = Math.max(0, printedSides(specs).length - 1) * estimation.bothSidesExtraDays;
  return base + garment + volume + sides;
}

/** Fonts used by a design, loaded before painting the 3D texture. */
export function fontsUsed(specs) {
  return [...new Set(layersOf(specs).textLayers.map((l) => l.font))];
}
