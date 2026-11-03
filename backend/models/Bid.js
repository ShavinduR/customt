const mongoose = require('mongoose');
const { BID_STATUS, AUCTION } = require('../config/constants');

const revisionSchema = new mongoose.Schema(
  {
    price: { type: Number, required: true },
    leadTimeDays: { type: Number, required: true },
    notes: { type: String, default: '' },
    rankBefore: { type: Number, default: null },
    submittedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const bidSchema = new mongoose.Schema(
  {
    rfqId: { type: mongoose.Schema.Types.ObjectId, ref: 'RFQ', required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendorName: { type: String, required: true },
    companyName: { type: String, default: '' },

    /** Total quoted price (LKR) for the full RFQ quantity. */
    price: { type: Number, required: true, min: [1, 'Price must be greater than zero'] },
    unitPrice: { type: Number, required: true },
    leadTimeDays: {
      type: Number,
      required: true,
      min: [1, 'Lead time must be at least 1 day'],
      max: [AUCTION.MAX_LEAD_TIME_DAYS, `Lead time cannot exceed ${AUCTION.MAX_LEAD_TIME_DAYS} days`],
      validate: { validator: Number.isInteger, message: 'Lead time must be a whole number of days' },
    },
    notes: { type: String, trim: true, maxlength: AUCTION.MAX_NOTES_LENGTH, default: '' },

    /** Vendor trust score captured at the moment of (re)bidding - used in scoring. */
    trustScoreSnapshot: { type: Number, required: true },
    score: { type: Number, default: 0 },
    rank: { type: Number, default: null },
    status: { type: String, enum: Object.values(BID_STATUS), default: BID_STATUS.ACTIVE },

    revisionCount: { type: Number, default: 0 },
    revisions: { type: [revisionSchema], default: [] },
    lastSubmittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Participant can hold exactly one live bid per RFQ (re-bids update it).
bidSchema.index({ rfqId: 1, vendorId: 1 }, { unique: true });
bidSchema.index({ rfqId: 1, rank: 1 });

module.exports = mongoose.model('Bid', bidSchema);
