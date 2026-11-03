const {
  SIZES,
  MIN_ORDER_QUANTITY,
  DELIVERY_ESTIMATION,
  PRINT_TYPES,
  GARMENT_TYPES,
  FABRICS,
  GSM_OPTIONS,
  PRINT_PLACEMENTS,
} = require('../config/constants');
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

/**
 * Expected delivery days = print-method base days + garment complexity
 * + 1 day per started block of 100 pieces beyond the first 100 + 1 day if printed on both sides.
 */
function calculateExpectedDeliveryDays({ printType, garmentType, totalQuantity, printPlacement }) {
  const base = DELIVERY_ESTIMATION.basePrintDays[printType] ?? 7;
  const garment = DELIVERY_ESTIMATION.garmentExtraDays[garmentType] ?? 0;
  const volume = Math.max(0, Math.ceil(totalQuantity / DELIVERY_ESTIMATION.piecesPerExtraDay) - 1);
  const sides = printPlacement === 'FRONT_AND_BACK' ? DELIVERY_ESTIMATION.bothSidesExtraDays : 0;
  return base + garment + volume + sides;
}

/**
 * Validates and normalises the visual configurator payload into a technical RFQ spec.
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

  const printPlacement = input.printPlacement || 'FRONT';
  if (!PRINT_PLACEMENTS.includes(printPlacement)) errors.push(`printPlacement must be one of: ${PRINT_PLACEMENTS.join(', ')}`);

  const customText = typeof input.customText === 'string' ? input.customText.trim() : '';
  if (customText.length > 120) errors.push('customText must be 120 characters or fewer');

  const backText = typeof input.backText === 'string' ? input.backText.trim() : '';
  if (backText.length > 120) errors.push('backText must be 120 characters or fewer');

  const textColor = input.textColor || '#FFFFFF';
  if (!HEX_COLOR.test(textColor)) errors.push('textColor must be a hex colour');

  const logoUrl = typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '';
  if (logoUrl && !/^(https?:\/\/|\/uploads\/)/i.test(logoUrl)) {
    errors.push('logoUrl must be an http(s) URL or a path returned by /api/uploads/logo');
  }

  if (!customText && !backText && !logoUrl) {
    errors.push('Add custom text or upload a logo so vendors know what to print');
  }

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

  const designPosition = input.designPosition && typeof input.designPosition === 'object' ? input.designPosition : {};
  const clamp = (v, min, max, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  return {
    garmentType: input.garmentType,
    fabric: input.fabric,
    gsm,
    color: input.color.toUpperCase(),
    printType: input.printType,
    printPlacement,
    customText,
    backText,
    textColor: textColor.toUpperCase(),
    logoUrl,
    designPosition: {
      x: clamp(designPosition.x, 0, 100, 50),
      y: clamp(designPosition.y, 0, 100, 35),
      scale: clamp(designPosition.scale, 0.2, 3, 1),
    },
    sizeBreakdown,
    totalQuantity,
  };
}

module.exports = {
  normaliseSizeBreakdown,
  calculateTotalQuantity,
  calculateExpectedDeliveryDays,
  buildDesignSpecs,
};
