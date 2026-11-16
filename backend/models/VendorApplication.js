/**
 * A buyer's application to become a vendor (KYB: Know Your Business).
 *
 * Kept out of the User document on purpose: User is loaded on every request and serialised in many
 * responses, while this holds sensitive evidence references and a full audit history.
 * Documents are stored privately (services/kybStorage.js); only their storage key is kept here, never a URL.
 * The full NIC is never stored: only an HMAC fingerprint and the last 4 characters (utils/nic.js).
 */
const mongoose = require('mongoose');
const { KYB, PRINT_TYPES } = require('../config/constants');

const { ObjectId } = mongoose.Schema.Types;

const APPLICATION_STATUS = ['DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'];

const documentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: KYB.DOC_TYPES, required: true },
    storageKey: { type: String, required: true }, // internal: never included in any API response (see kybService views)
    originalName: { type: String, maxlength: 120 },
    mimeType: { type: String, enum: KYB.MIME_TYPES, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    issuedOn: { type: Date }, // invoice date / bill date, entered by the applicant
    review: {
      status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED'], default: 'PENDING' },
      reason: { type: String, maxlength: 300, default: '' },
      reviewedBy: { type: ObjectId, ref: 'User' },
      reviewedAt: { type: Date },
    },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const historySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    actorId: { type: ObjectId, ref: 'User' },
    actorRole: { type: String, enum: ['applicant', 'admin', 'system'], required: true },
    note: { type: String, maxlength: 500, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const vendorApplicationSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: APPLICATION_STATUS, default: 'DRAFT', index: true },
    submissionCount: { type: Number, default: 0 },

    business: {
      legalName: { type: String, trim: true, maxlength: 150 },
      tradingName: { type: String, trim: true, maxlength: 150 },
      businessRegNo: { type: String, trim: true, uppercase: true, maxlength: 50 },
      address: {
        line1: { type: String, trim: true, maxlength: 150 },
        line2: { type: String, trim: true, maxlength: 150 },
        city: { type: String, trim: true, maxlength: 80 },
        district: { type: String, trim: true, maxlength: 80 },
        postalCode: { type: String, trim: true, maxlength: 10 },
      },
      capabilities: { type: [{ type: String, enum: PRINT_TYPES }], default: [] },
      maxCapacity: { type: Number, min: 1, max: 1000000 },
      licenseExpiryDate: { type: Date },
    },

    owner: {
      fullName: { type: String, trim: true, maxlength: 120 },
      nicHash: { type: String, select: false, index: true },
      nicLast4: { type: String, maxlength: 4 },
    },

    documents: { type: [documentSchema], default: [] },

    // Server-computed signals for the reviewer (e.g. NIC already used by another vendor account).
    riskFlags: { type: [String], default: [] },

    consentAt: { type: Date },
    submittedAt: { type: Date },
    decision: {
      outcome: { type: String, enum: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED', null], default: null },
      notes: { type: String, maxlength: 1000, default: '' },
      decidedBy: { type: ObjectId, ref: 'User' },
      decidedAt: { type: Date },
    },
    history: { type: [historySchema], default: [] },

    // Documents of rejected / withdrawn applications are deleted after this date (data minimisation).
    purgeAfter: { type: Date, index: true },
    documentsPurgedAt: { type: Date },
  },
  {
    timestamps: true,
    // Two admins (or an admin and the applicant) can never overwrite each other's changes.
    optimisticConcurrency: true,
  }
);

vendorApplicationSchema.index({ status: 1, submittedAt: 1 });
// At most one open (non-final) application per user.
vendorApplicationSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED'] } }, name: 'one_open_application_per_user' }
);

module.exports = mongoose.model('VendorApplication', vendorApplicationSchema);
module.exports.APPLICATION_STATUS = APPLICATION_STATUS;
