/**
 * Domain constants shared across models, services and routes.
 * Exposed to the frontend via GET /api/meta/catalog so both sides stay in sync.
 */

const ROLES = Object.freeze({
  BUYER: 'buyer',
  VENDOR: 'vendor',
  ADMIN: 'admin',
});

const PRINT_TYPES = Object.freeze(['Screen Printing', 'DTF', 'Embroidery', 'Sublimation']);
const GARMENT_TYPES = Object.freeze(['Crew Neck', 'Polo', 'Hoodie']);
const FABRICS = Object.freeze(['100% Cotton', 'Pique/Crocodile', 'Dry-Fit/Wetlook']);
const GSM_OPTIONS = Object.freeze([160, 180, 200, 220]);
const SIZES = Object.freeze(['S', 'M', 'L', 'XL', 'XXL']);
const PRINT_PLACEMENTS = Object.freeze(['FRONT', 'BACK', 'FRONT_AND_BACK']);

const SKILL_BADGES = Object.freeze([
  'Verified Quality',
  'Fast Delivery',
  'Bulk Specialist',
  'Premium Embroidery',
  'Eco-Friendly Inks',
  'On-Time Champion',
  'Top Rated',
]);

const MIN_ORDER_QUANTITY = 20;

/** Layered artwork rules for the visual configurator (Module 1). */
const DESIGN = Object.freeze({
  SIDES: Object.freeze(['front', 'back', 'leftSleeve', 'rightSleeve']),
  FONTS: Object.freeze(['Bebas Neue', 'Montserrat', 'Playfair Display', 'Pacifico']),
  MAX_TEXT_LAYERS: 8,
  MAX_IMAGE_LAYERS: 8,
  TEXT_MAX: 60,
  SIZE_MIN: 6,
  SIZE_MAX: 96,
  SCALE_MIN: 0.1,
  SCALE_MAX: 1,
});

/** Module 1 - automatic expected-delivery estimation (working days). */
const DELIVERY_ESTIMATION = Object.freeze({
  basePrintDays: {
    'Screen Printing': 7,
    DTF: 5,
    Embroidery: 10,
    Sublimation: 6,
  },
  garmentExtraDays: {
    'Crew Neck': 0,
    Polo: 1,
    Hoodie: 2,
  },
  piecesPerExtraDay: 100,
  bothSidesExtraDays: 1,
});

/** Module 2 - auction engine. */
const AUCTION = Object.freeze({
  SOFT_CLOSE_WINDOW_MS: 2 * 60 * 1000,
  SOFT_CLOSE_EXTENSION_MS: 5 * 60 * 1000,
  WEIGHTS: Object.freeze({ price: 0.5, trust: 0.3, leadTime: 0.2 }),
  PRICE_CV_THRESHOLD: 0.35,
  PRICE_CV_MIN_BIDS: 3,
  MAX_LEAD_TIME_DAYS: 120,
  MAX_NOTES_LENGTH: 500,
  MIN_LEAD_TIME_RATIO: 0.5, // bids must quote at least half of the platform's realistic production estimate
});

const RFQ_STATUS = Object.freeze({
  OPEN: 'OPEN',
  CLOSED: 'CLOSED', // bidding window ended with bids, waiting for buyer award
  AWARDED: 'AWARDED',
  EXPIRED: 'EXPIRED', // bidding window ended with zero bids
  CANCELLED: 'CANCELLED',
});

const BID_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
});

/** Module 3 - escrow & O2O. */
const ORDER_STATUS = Object.freeze({
  PENDING_ESCROW: 'PENDING_ESCROW',
  IN_PROGRESS: 'IN_PROGRESS',
  AWAITING_O2O: 'AWAITING_O2O',
  DISPUTED: 'DISPUTED',
  COMPLETED: 'COMPLETED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
});

const ESCROW_STATUS = Object.freeze({
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  ESCROW_LOCKED: 'ESCROW_LOCKED',
  PARTIALLY_RELEASED: 'PARTIALLY_RELEASED', // 30% advance released, 70% still held
  FROZEN: 'FROZEN', // dispute raised
  FUNDS_RELEASED: 'FUNDS_RELEASED',
  REFUNDED: 'REFUNDED',
  SPLIT_SETTLED: 'SPLIT_SETTLED',
});

const PRODUCTION_STATUS = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  MATERIAL_SOURCED: 'MATERIAL_SOURCED',
  IN_PRODUCTION: 'IN_PRODUCTION',
  READY_FOR_INSPECTION: 'READY_FOR_INSPECTION',
  DELIVERED: 'DELIVERED',
});

/** Allowed vendor-driven production transitions (strict linear workflow). */
const PRODUCTION_FLOW = Object.freeze({
  [PRODUCTION_STATUS.NOT_STARTED]: PRODUCTION_STATUS.MATERIAL_SOURCED,
  [PRODUCTION_STATUS.MATERIAL_SOURCED]: PRODUCTION_STATUS.IN_PRODUCTION,
  [PRODUCTION_STATUS.IN_PRODUCTION]: PRODUCTION_STATUS.READY_FOR_INSPECTION,
});

const ESCROW = Object.freeze({
  ADVANCE_RATIO: 0.3,
  FINAL_RATIO: 0.7,
  O2O_PIN_LENGTH: 6,
  O2O_MAX_ATTEMPTS: 5,
});

const TRUST = Object.freeze({
  DEFAULT: 3.5,
  MIN: 1,
  MAX: 5,
  EWMA_OLD_WEIGHT: 0.7,
  EWMA_NEW_WEIGHT: 0.3,
  // Anti-collusion: only one rating per buyer-vendor pair in this window changes the trust score.
  PAIR_RATING_WINDOW_DAYS: 30,
});

const DISPUTE_CATEGORIES = Object.freeze({
  PRINT_QUALITY: 'Print quality (cracking, fading, blurred artwork)',
  COLOR_MISMATCH: 'Garment or ink colour does not match the approved design',
  SIZE_DISCREPANCY: 'Size breakdown or measurements differ from the order',
  QUANTITY_SHORTFALL: 'Fewer pieces delivered than ordered',
  FABRIC_ISSUE: 'Fabric type or GSM differs from the specification',
  DESIGN_DEVIATION: 'Logo, text or placement deviates from the locked design',
  OTHER: 'Other quality concern',
});

const DISPUTE_DESIRED_RESOLUTIONS = Object.freeze(['REPRINT', 'PARTIAL_REFUND', 'FULL_REFUND', 'OTHER']);

const DISPUTE_RESOLUTIONS = Object.freeze({
  RELEASE_TO_VENDOR: 'RELEASE_TO_VENDOR',
  REFUND_BUYER: 'REFUND_BUYER',
  SPLIT: 'SPLIT',
  RESUME_PRODUCTION: 'RESUME_PRODUCTION', // e.g. vendor agrees to reprint
});

module.exports = {
  ROLES,
  PRINT_TYPES,
  GARMENT_TYPES,
  FABRICS,
  GSM_OPTIONS,
  SIZES,
  PRINT_PLACEMENTS,
  SKILL_BADGES,
  MIN_ORDER_QUANTITY,
  DESIGN,
  DELIVERY_ESTIMATION,
  AUCTION,
  RFQ_STATUS,
  BID_STATUS,
  ORDER_STATUS,
  ESCROW_STATUS,
  PRODUCTION_STATUS,
  PRODUCTION_FLOW,
  ESCROW,
  TRUST,
  DISPUTE_CATEGORIES,
  DISPUTE_DESIRED_RESOLUTIONS,
  DISPUTE_RESOLUTIONS,
};
