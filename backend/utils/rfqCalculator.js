const {
  SIZES,
  MIN_ORDER_QUANTITY,
  DELIVERY_ESTIMATION,
  PRINT_TYPES,
  GARMENT_TYPES,
  FABRICS,
  GSM_OPTIONS,
  PRINT_PLACEMENTS,
  DESIGN,
} = require('../config/constants');
const { isUploadedFileUrl } = require('./uploadUrl');
const ApiError = require('./ApiError');

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalises a size matrix into { S, M, L, XL, XXL } of non-negative integers. */
function normaliseSizeBreakdown(raw = {}) {
  return SIZES.reduce((acc, size) => {
    const value = Number(raw[size] ?? 0);
    if (!Number.isInteger(value) || value < 0) {
      throw ApiError.badRequest(`Size ${size} must be a whole number of 0 or more`);
    }
    acc[size] = value;
    return acc;
  }, {});
}

function calculateTotalQuantity(sizeBreakdown) {
  return SIZES.reduce((sum, size) => sum + (Number(sizeBreakdown[size]) || 0), 0);
}

/** Number of printed sides: from the layers when present, otherwise from the legacy placement. */
function countPrintedSides({ printedSides, printPlacement }) {
  if (Array.isArray(printedSides) && printedSides.length) return printedSides.length;
  return printPlacement === 'FRONT_AND_BACK' ? 2 : 1;
}

/**
 * Expected delivery days = print-method base days + garment complexity
 * + 1 day per started block of 100 pieces beyond the first 100 + 1 day per extra printed side.
 */
function calculateExpectedDeliveryDays(specs) {
  const { printType, garmentType, totalQuantity } = specs;
  const base = DELIVERY_ESTIMATION.basePrintDays[printType] ?? 7;
  const garment = DELIVERY_ESTIMATION.garmentExtraDays[garmentType] ?? 0;
  const volume = Math.max(0, Math.ceil(totalQuantity / DELIVERY_ESTIMATION.piecesPerExtraDay) - 1);
  const sides = Math.max(0, countPrintedSides(specs) - 1) * DELIVERY_ESTIMATION.bothSidesExtraDays;
  return base + garment + volume + sides;
}

const clamp = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const round1 = (n) => Math.round(n * 10) / 10;
const cleanId = (id, fallback) => (typeof id === 'string' && /^[\w-]{1,40}$/.test(id) ? id : fallback);

/** Converts the original single text/logo design format into layers (older clients and RFQs). */
function legacyLayers(input) {
  const pos = input.designPosition && typeof input.designPosition === 'object' ? input.designPosition : {};
  const x = clamp(pos.x, 0, 100, 50);
  const y = clamp(pos.y, 0, 100, 35);
  const scale = clamp(pos.scale, 0.2, 3, 1);
  const placement = input.printPlacement || 'FRONT';
  const customText = typeof input.customText === 'string' ? input.customText.trim() : '';
  const backText = typeof input.backText === 'string' ? input.backText.trim() : '';
  const logoUrl = typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '';
  const color = HEX_COLOR.test(input.textColor || '') ? input.textColor : '#FFFFFF';

  const textLayers = [];
  const imageLayers = [];
  const addSide = (side, text, withLogo) => {
    if (withLogo && logoUrl) imageLayers.push({ id: `legacy-img-${side}`, side, url: logoUrl, x, y: Math.max(0, y - (text ? 8 : 0)), scale: Math.min(1, 0.7 * scale) });
    if (text) textLayers.push({ id: `legacy-txt-${side}`, side, text: text.slice(0, DESIGN.TEXT_MAX), font: DESIGN.FONTS[0], size: Math.round(26 * scale), color, x, y: Math.min(100, y + (withLogo && logoUrl ? 22 : 0)) });
  };
  if (placement === 'BACK') addSide('back', customText || backText, true);
  else {
    addSide('front', customText, true);
    if (placement === 'FRONT_AND_BACK') addSide('back', backText || customText, false);
  }
  return { textLayers, imageLayers };
}

/** Validates text and image layers; returns cleaned copies plus a list of problems. */
function validateLayers(rawText, rawImages) {
  const errors = [];
  if (!Array.isArray(rawText) || !Array.isArray(rawImages)) {
    return { errors: ['textLayers and imageLayers must be arrays'], textLayers: [], imageLayers: [] };
  }
  if (rawText.length > DESIGN.MAX_TEXT_LAYERS) errors.push(`Use at most ${DESIGN.MAX_TEXT_LAYERS} text layers`);
  if (rawImages.length > DESIGN.MAX_IMAGE_LAYERS) errors.push(`Use at most ${DESIGN.MAX_IMAGE_LAYERS} images`);

  const textLayers = rawText.slice(0, DESIGN.MAX_TEXT_LAYERS).map((l, i) => {
    const layer = l && typeof l === 'object' ? l : {};
    const text = typeof layer.text === 'string' ? layer.text.trim() : '';
    const n = i + 1;
    if (!DESIGN.SIDES.includes(layer.side)) errors.push(`Text ${n}: side must be one of ${DESIGN.SIDES.join(', ')}`);
    if (!text) errors.push(`Text ${n} is empty`);
    if (text.length > DESIGN.TEXT_MAX) errors.push(`Text ${n} must be ${DESIGN.TEXT_MAX} characters or fewer`);
    if (!DESIGN.FONTS.includes(layer.font)) errors.push(`Text ${n}: font must be one of ${DESIGN.FONTS.join(', ')}`);
    if (!HEX_COLOR.test(String(layer.color || ''))) errors.push(`Text ${n}: colour must be a hex colour such as #FFFFFF`);
    return {
      id: cleanId(layer.id, `t${n}`),
      side: layer.side,
      text,
      font: layer.font,
      size: round1(clamp(layer.size, DESIGN.SIZE_MIN, DESIGN.SIZE_MAX, 24)),
      color: String(layer.color || '').toUpperCase(),
      x: round1(clamp(layer.x, 0, 100, 50)),
      y: round1(clamp(layer.y, 0, 100, 50)),
    };
  });

  const imageLayers = rawImages.slice(0, DESIGN.MAX_IMAGE_LAYERS).map((l, i) => {
    const layer = l && typeof l === 'object' ? l : {};
    const url = typeof layer.url === 'string' ? layer.url.trim() : '';
    const n = i + 1;
    if (!DESIGN.SIDES.includes(layer.side)) errors.push(`Image ${n}: side must be one of ${DESIGN.SIDES.join(', ')}`);
    if (!isUploadedFileUrl(url)) errors.push(`Image ${n}: use an image uploaded to CustomT (POST /api/uploads/logo)`);
    return {
      id: cleanId(layer.id, `i${n}`),
      side: layer.side,
      url,
      x: round1(clamp(layer.x, 0, 100, 50)),
      y: round1(clamp(layer.y, 0, 100, 50)),
      scale: Math.round(clamp(layer.scale, DESIGN.SCALE_MIN, DESIGN.SCALE_MAX, 0.5) * 100) / 100,
    };
  });

  return { errors, textLayers, imageLayers };
}

/**
 * Validates and normalises the visual configurator payload into a technical RFQ spec.
 * Accepts the layered format (textLayers / imageLayers) or the original single text/logo format.
 * Throws ApiError(400) with a precise message on any invalid field.
 */
function buildDesignSpecs(input = {}) {
  const errors = [];

  if (!GARMENT_TYPES.includes(input.garmentType)) errors.push(`garmentType must be one of: ${GARMENT_TYPES.join(', ')}`);
  if (!FABRICS.includes(input.fabric)) errors.push(`fabric must be one of: ${FABRICS.join(', ')}`);
  const gsm = Number(input.gsm);
  if (!GSM_OPTIONS.includes(gsm)) errors.push(`gsm must be one of: ${GSM_OPTIONS.join(', ')}`);
  if (!HEX_COLOR.test(String(input.color || ''))) errors.push('color must be a hex colour such as #1E3A8A');
  if (!PRINT_TYPES.includes(input.printType)) errors.push(`printType must be one of: ${PRINT_TYPES.join(', ')}`);

  const layered = Array.isArray(input.textLayers) || Array.isArray(input.imageLayers);
  if (!layered && input.printPlacement && !PRINT_PLACEMENTS.includes(input.printPlacement)) {
    errors.push(`printPlacement must be one of: ${PRINT_PLACEMENTS.join(', ')}`);
  }
  if (!layered) {
    if (typeof input.customText === 'string' && input.customText.trim().length > 120) errors.push('customText must be 120 characters or fewer');
    if (typeof input.backText === 'string' && input.backText.trim().length > 120) errors.push('backText must be 120 characters or fewer');
    const logo = typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '';
    if (logo && !isUploadedFileUrl(logo)) errors.push('logoUrl must be a URL returned by /api/uploads/logo');
  }
  const source = layered ? { textLayers: input.textLayers || [], imageLayers: input.imageLayers || [] } : legacyLayers(input);
  const { errors: layerErrors, textLayers, imageLayers } = validateLayers(source.textLayers, source.imageLayers);
  errors.push(...layerErrors);
  if (textLayers.length + imageLayers.length === 0) errors.push('Add text or an image so vendors know what to print');

  if (errors.length) {
    throw ApiError.badRequest('Invalid design specification', { details: errors });
  }

  const sizeBreakdown = normaliseSizeBreakdown(input.sizeBreakdown);
  const totalQuantity = calculateTotalQuantity(sizeBreakdown);
  if (totalQuantity < MIN_ORDER_QUANTITY) {
    throw ApiError.badRequest(`Minimum order quantity is ${MIN_ORDER_QUANTITY} pieces (current: ${totalQuantity})`, {
      code: 'MOQ_NOT_MET',
    });
  }

  const used = new Set([...textLayers, ...imageLayers].map((l) => l.side));
  const printedSides = DESIGN.SIDES.filter((side) => used.has(side));
  const front = used.has('front') || used.has('leftSleeve') || used.has('rightSleeve');
  const printPlacement = front && used.has('back') ? 'FRONT_AND_BACK' : used.has('back') ? 'BACK' : 'FRONT';
  const firstText = (side) => textLayers.find((l) => l.side === side)?.text || '';

  return {
    garmentType: input.garmentType,
    fabric: input.fabric,
    gsm,
    color: input.color.toUpperCase(),
    printType: input.printType,
    printPlacement,
    printedSides,
    textLayers,
    imageLayers,
    // Summary fields kept for older screens and reports.
    customText: firstText('front') || firstText('back'),
    backText: firstText('back'),
    textColor: textLayers[0]?.color || '#FFFFFF',
    logoUrl: imageLayers[0]?.url || '',
    sizeBreakdown,
    totalQuantity,
  };
}

module.exports = {
  normaliseSizeBreakdown,
  calculateTotalQuantity,
  calculateExpectedDeliveryDays,
  buildDesignSpecs,
  legacyLayers,
};
