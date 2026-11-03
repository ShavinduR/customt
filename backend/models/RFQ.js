const mongoose = require('mongoose');
const {
  RFQ_STATUS,
  PRINT_TYPES,
  GARMENT_TYPES,
  FABRICS,
  GSM_OPTIONS,
  PRINT_PLACEMENTS,
  SIZES,
  MIN_ORDER_QUANTITY,
} = require('../config/constants');
const ApiError = require('../utils/ApiError');

const sizeBreakdownSchema = new mongoose.Schema(
  SIZES.reduce((acc, size) => {
    acc[size] = { type: Number, default: 0, min: 0 };
    return acc;
  }, {}),
  { _id: false }
);

const designSpecsSchema = new mongoose.Schema(
  {
    garmentType: { type: String, enum: GARMENT_TYPES, required: true },
    fabric: { type: String, enum: FABRICS, required: true },
    gsm: { type: Number, enum: GSM_OPTIONS, required: true },
    color: { type: String, required: true, match: /^#([0-9A-F]{3}|[0-9A-F]{6})$/i },
    printType: { type: String, enum: PRINT_TYPES, required: true },
    printPlacement: { type: String, enum: PRINT_PLACEMENTS, default: 'FRONT' },
    customText: { type: String, trim: true, maxlength: 120, default: '' },
    backText: { type: String, trim: true, maxlength: 120, default: '' },
    textColor: { type: String, default: '#FFFFFF' },
    logoUrl: { type: String, trim: true, default: '' },
    designPosition: {
      x: { type: Number, default: 50 },
      y: { type: Number, default: 35 },
      scale: { type: Number, default: 1 },
    },
    sizeBreakdown: { type: sizeBreakdownSchema, required: true },
    totalQuantity: { type: Number, required: true, min: MIN_ORDER_QUANTITY },
  },
  { _id: false }
);

const priceDiagnosticSchema = new mongoose.Schema(
  {
    bidCount: { type: Number, default: 0 },
    mean: { type: Number, default: null },
    stdDev: { type: Number, default: null },
    coefficientOfVariation: { type: Number, default: null },
    highVariance: { type: Boolean, default: false },
    message: { type: String, default: null },
    evaluatedAt: { type: Date },
  },
  { _id: false }
);

const rfqSchema = new mongoose.Schema(
  {
    rfqCode: { type: String, required: true, unique: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: [true, 'RFQ title is required'], trim: true, minlength: 3, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    designSpecs: { type: designSpecsSchema, required: true },
    expectedDeliveryDays: { type: Number, required: true, min: 1 },

    status: { type: String, enum: Object.values(RFQ_STATUS), default: RFQ_STATUS.OPEN, index: true },

    // CPAPO mitigation: specs are frozen the moment bidding opens.
    isLocked: { type: Boolean, default: true },
    lockedAt: { type: Date, default: Date.now },

    expiresAt: { type: Date, required: true, index: true },
    originalExpiresAt: { type: Date, required: true },
    extensionCount: { type: Number, default: 0 },
    eligibleVendorCount: { type: Number, default: 0 },
    bidCount: { type: Number, default: 0 },
    priceDiagnostic: { type: priceDiagnosticSchema, default: () => ({}) },

    awardedBidId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bid' },
    awardedVendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    awardedAt: { type: Date },
    closedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

rfqSchema.index({ status: 1, expiresAt: 1 });
rfqSchema.index({ 'designSpecs.printType': 1, 'designSpecs.totalQuantity': 1, status: 1 });

rfqSchema.virtual('timeRemainingMs').get(function timeRemainingMs() {
  if (this.status !== RFQ_STATUS.OPEN || !this.expiresAt) return 0;
  return Math.max(0, this.expiresAt.getTime() - Date.now());
});

const CPAPO_MESSAGE =
  'Design specifications are locked once an RFQ is open for bidding (CPAPO protection). Cancel this RFQ and create a new one to change the design.';

// Document-level guard.
rfqSchema.pre('save', function enforceSpecLock(next) {
  if (!this.isNew && this.isLocked && (this.isModified('designSpecs') || this.isModified('expectedDeliveryDays'))) {
    return next(ApiError.locked(CPAPO_MESSAGE, { code: 'CPAPO_SPEC_LOCK' }));
  }
  return next();
});

// Query-level guard so specs can't be bypassed with updateOne/findOneAndUpdate.
function touchesLockedFields(update = {}) {
  const flatten = (obj) => Object.keys(obj || {});
  const keys = [
    ...flatten(update),
    ...flatten(update.$set),
    ...flatten(update.$unset),
    ...flatten(update.$inc),
    ...flatten(update.$push),
  ];
  return keys.some((key) => key.startsWith('designSpecs') || key === 'expectedDeliveryDays');
}

rfqSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function enforceQuerySpecLock(next) {
  if (touchesLockedFields(this.getUpdate())) {
    return next(ApiError.locked(CPAPO_MESSAGE, { code: 'CPAPO_SPEC_LOCK' }));
  }
  return next();
});

module.exports = mongoose.model('RFQ', rfqSchema);
module.exports.CPAPO_MESSAGE = CPAPO_MESSAGE;
