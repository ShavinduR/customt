const mongoose = require('mongoose');
const {
  ORDER_STATUS,
  ESCROW_STATUS,
  PRODUCTION_STATUS,
  DISPUTE_CATEGORIES,
  DISPUTE_DESIRED_RESOLUTIONS,
  DISPUTE_RESOLUTIONS,
  ROLES,
} = require('../config/constants');

const { ObjectId } = mongoose.Schema.Types;

const ledgerEntrySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['ESCROW_DEPOSIT', 'ADVANCE_RELEASE', 'FINAL_RELEASE', 'DISPUTE_RELEASE', 'REFUND'],
      required: true,
    },
    amount: { type: Number, required: true },
    toUserId: { type: ObjectId, ref: 'User' },
    reference: { type: String },
    note: { type: String },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const timelineEntrySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: '' },
    actorId: { type: ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const disputeNoteSchema = new mongoose.Schema(
  {
    authorId: { type: ObjectId, ref: 'User' },
    authorRole: { type: String, enum: [...Object.values(ROLES), 'system'], required: true },
    audience: { type: String, enum: ['buyer', 'vendor', 'admin', 'all'], default: 'all' },
    template: {
      type: String,
      enum: ['BUYER_ACKNOWLEDGEMENT', 'VENDOR_NOTIFICATION', 'ADMIN_CASE_SUMMARY', 'FOLLOW_UP', 'RESOLUTION'],
      required: true,
    },
    message: { type: String, required: true, maxlength: 5000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const orderSchema = new mongoose.Schema(
  {
    orderCode: { type: String, required: true, unique: true },
    rfqId: { type: ObjectId, ref: 'RFQ', required: true, unique: true },
    buyerId: { type: ObjectId, ref: 'User', required: true, index: true },
    vendorId: { type: ObjectId, ref: 'User', required: true, index: true },
    bidId: { type: ObjectId, ref: 'Bid', required: true },

    // Snapshot of the locked spec so analytics never depend on mutable data.
    specSnapshot: {
      title: String,
      rfqCode: String,
      garmentType: String,
      fabric: String,
      gsm: Number,
      printType: String,
      totalQuantity: Number,
    },

    agreedPrice: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true },
    leadTimeDays: { type: Number, required: true },
    advanceAmount: { type: Number, required: true },
    finalAmount: { type: Number, required: true },

    advanceReleased: { type: Boolean, default: false },
    advanceReleasedAt: { type: Date },
    finalReleased: { type: Boolean, default: false },
    finalReleasedAt: { type: Date },
    escrowHeld: { type: Number, default: 0, min: 0 },
    refundedAmount: { type: Number, default: 0 },

    orderStatus: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING_ESCROW, index: true },
    escrowStatus: { type: String, enum: Object.values(ESCROW_STATUS), default: ESCROW_STATUS.AWAITING_PAYMENT, index: true },
    productionStatus: { type: String, enum: Object.values(PRODUCTION_STATUS), default: PRODUCTION_STATUS.NOT_STARTED },
    productionTimeline: { type: [timelineEntrySchema], default: [] },

    payment: {
      transactionRef: String,
      method: String,
      cardBrand: String,
      cardLast4: String,
      amount: Number,
      paidAt: Date,
    },
    escrowLedger: { type: [ledgerEntrySchema], default: [] },

    // ── O2O verification ───────────────────────────────────────────
    o2oPin: { type: String, select: false },
    o2oPinGeneratedAt: { type: Date },
    o2oAttempts: { type: Number, default: 0 },
    o2oVerifiedAt: { type: Date },
    o2oMethod: { type: String, enum: ['PIN', 'BUYER_APPROVAL', 'ADMIN_RESOLUTION', null], default: null },

    // ── Dispute (Politeness CRM) ───────────────────────────────────
    dispute: {
      isOpen: { type: Boolean, default: false },
      category: { type: String, enum: [...Object.keys(DISPUTE_CATEGORIES), null], default: null },
      desiredResolution: { type: String, enum: [...DISPUTE_DESIRED_RESOLUTIONS, null], default: null },
      description: { type: String, maxlength: 2000 },
      evidenceUrls: { type: [String], default: [] },
      toneFlagged: { type: Boolean, default: false },
      raisedAt: Date,
      previousEscrowStatus: String,
      previousOrderStatus: String,
      resolution: { type: String, enum: [...Object.values(DISPUTE_RESOLUTIONS), null], default: null },
      resolutionNotes: String,
      vendorAmount: Number,
      buyerAmount: Number,
      resolvedAt: Date,
      resolvedBy: { type: ObjectId, ref: 'User' },
    },
    disputeNotes: { type: [disputeNoteSchema], default: [] },

    buyerRating: {
      rating: { type: Number, min: 1, max: 5 },
      review: { type: String, trim: true, maxlength: 1000 },
      trustBefore: Number,
      trustAfter: Number,
      ratedAt: Date,
    },

    completedAt: { type: Date },
    cancelledAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

orderSchema.index({ 'dispute.isOpen': 1 });

orderSchema.virtual('amountReleasedToVendor').get(function amountReleasedToVendor() {
  return (this.escrowLedger || [])
    .filter((e) => ['ADVANCE_RELEASE', 'FINAL_RELEASE', 'DISPUTE_RELEASE'].includes(e.type))
    .reduce((sum, e) => sum + e.amount, 0);
});

module.exports = mongoose.model('Order', orderSchema);
