/** Human labels + badge tones for every backend status value. */
export const STATUS_META = {
  // RFQ
  OPEN: { label: 'Live auction', tone: 'green', pulse: true },
  CLOSED: { label: 'Awaiting your decision', tone: 'amber' },
  AWARDED: { label: 'Awarded', tone: 'brand' },
  EXPIRED: { label: 'Expired (no bids)', tone: 'slate' },
  CANCELLED: { label: 'Cancelled', tone: 'slate' },
  // Order
  PENDING_ESCROW: { label: 'Awaiting payment', tone: 'amber' },
  IN_PROGRESS: { label: 'In production', tone: 'blue' },
  AWAITING_O2O: { label: 'Ready for inspection', tone: 'violet' },
  DISPUTED: { label: 'Disputed', tone: 'red' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  REFUNDED: { label: 'Refunded', tone: 'slate' },
  // Escrow
  AWAITING_PAYMENT: { label: 'Not funded', tone: 'amber' },
  ESCROW_LOCKED: { label: 'Escrow locked', tone: 'blue' },
  PARTIALLY_RELEASED: { label: '30% released', tone: 'blue' },
  FROZEN: { label: 'Escrow frozen', tone: 'red' },
  FUNDS_RELEASED: { label: 'Funds released', tone: 'green' },
  SPLIT_SETTLED: { label: 'Split settled', tone: 'slate' },
  // Production
  NOT_STARTED: { label: 'Not started', tone: 'slate' },
  MATERIAL_SOURCED: { label: 'Material sourced', tone: 'blue' },
  IN_PRODUCTION: { label: 'In production', tone: 'blue' },
  READY_FOR_INSPECTION: { label: 'Ready for inspection', tone: 'violet' },
  DELIVERED: { label: 'Delivered', tone: 'green' },
};

export const statusMeta = (status) => STATUS_META[status] || { label: status, tone: 'slate' };

export const PRINT_TYPE_INFO = {
  'Screen Printing': { blurb: 'Vivid, durable ink. Best value for bulk runs with few colours.', icon: 'Layers' },
  DTF: { blurb: 'Direct-to-film transfers. Full colour photos and gradients on any fabric.', icon: 'Sparkles' },
  Embroidery: { blurb: 'Stitched thread. Premium, textured look for logos and polos.', icon: 'Scissors' },
  Sublimation: { blurb: 'Dye fused into polyester. Never cracks; ideal for Dry-Fit sportswear.', icon: 'Droplets' },
};

export const GARMENT_INFO = {
  'Crew Neck': 'Classic round-neck tee for events and campaigns',
  Polo: 'Collared shirt for corporate and staff uniforms',
  Hoodie: 'Warm pullover with hood and front pocket',
};

export const FABRIC_INFO = {
  '100% Cotton': { blurb: 'Soft, breathable everyday cotton', pattern: 'cotton' },
  'Pique/Crocodile': { blurb: 'Textured knit typical of polo shirts', pattern: 'pique' },
  'Dry-Fit/Wetlook': { blurb: 'Moisture-wicking polyester for sport', pattern: 'mesh' },
};

export const COLOR_SWATCHES = [
  { hex: '#FFFFFF', name: 'White' },
  { hex: '#111827', name: 'Jet Black' },
  { hex: '#1E3A8A', name: 'Navy' },
  { hex: '#2563EB', name: 'Royal Blue' },
  { hex: '#0EA5E9', name: 'Sky' },
  { hex: '#DC2626', name: 'Red' },
  { hex: '#7F1D1D', name: 'Maroon' },
  { hex: '#15803D', name: 'Green' },
  { hex: '#065F46', name: 'Bottle Green' },
  { hex: '#F59E0B', name: 'Mustard' },
  { hex: '#7C3AED', name: 'Purple' },
  { hex: '#6B7280', name: 'Ash Grey' },
];

/** Readable foreground for a given hex background. */
export function contrastText(hex = '#FFFFFF') {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#FFFFFF';
}

/** Adjust hex brightness by percentage (-100..100). */
export function shade(hex = '#FFFFFF', percent = 0) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  const amt = Math.round(2.55 * percent);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
