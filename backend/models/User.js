const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, PRINT_TYPES, SKILL_BADGES, TRUST } = require('../config/constants');

const isVendor = function isVendor() {
  return this.role === ROLES.VENDOR;
};

const isNotAdmin = function isNotAdmin() {
  return this.role !== ROLES.ADMIN;
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    passwordHash: { type: String, required: true, select: false },
    phone: {
      type: String,
      trim: true,
      required: [isNotAdmin, 'Phone number is required'],
      match: [/^\+?[0-9][0-9\s-]{6,18}$/, 'Please provide a valid phone number'],
    },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.BUYER, required: true, index: true },

    // ── Vendor (SME printer) profile ───────────────────────────────
    companyName: { type: String, trim: true, maxlength: 150, required: [isVendor, 'Company name is required for vendors'] },
    businessRegNo: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 50,
      required: [isVendor, 'Business registration number is required for vendors'],
    },
    capabilities: {
      type: [{ type: String, enum: PRINT_TYPES }],
      default: [],
      validate: {
        validator(value) {
          if (this.role !== ROLES.VENDOR) return true;
          return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length;
        },
        message: 'Vendors must declare at least one unique printing capability',
      },
    },
    maxCapacity: {
      type: Number,
      min: [1, 'Maximum capacity must be at least 1 piece'],
      validate: { validator: Number.isInteger, message: 'Maximum capacity must be a whole number' },
      required: [isVendor, 'Maximum capacity is required for vendors'],
    },
    trustScore: { type: Number, default: TRUST.DEFAULT, min: TRUST.MIN, max: TRUST.MAX },
    ratingCount: { type: Number, default: 0, min: 0 },
    skillBadges: { type: [{ type: String, enum: SKILL_BADGES }], default: [] },

    // ── PERA qualification-level lock ──────────────────────────────
    isVerified: { type: Boolean, default: false, index: true },
    licenseExpiryDate: { type: Date },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verificationNotes: { type: String, trim: true, maxlength: 500 },

    // ── Virtual wallets (escrow payouts for vendors / refunds for buyers) ──
    walletBalance: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

userSchema.index({ role: 1, isVerified: 1, capabilities: 1, maxCapacity: 1 });

/** Qualification-level lock: verified AND license not expired. */
userSchema.virtual('isPrequalified').get(function isPrequalified() {
  return (
    this.role === ROLES.VENDOR &&
    this.isActive !== false &&
    this.isVerified === true &&
    this.licenseExpiryDate instanceof Date &&
    this.licenseExpiryDate.getTime() > Date.now()
  );
});

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

/** Returns the reasons (if any) this vendor fails the PERA qualification-level lock. */
userSchema.methods.qualificationIssues = function qualificationIssues() {
  const issues = [];
  if (this.role !== ROLES.VENDOR) issues.push('Only vendor accounts can take part in auctions');
  if (this.isActive === false) issues.push('Your account has been suspended');
  if (!this.isVerified) issues.push('Your business has not yet been verified by a CustomT administrator');
  if (!this.licenseExpiryDate) issues.push('No business license expiry date is on record');
  else if (this.licenseExpiryDate.getTime() <= Date.now()) issues.push('Your business license has expired - please renew it and contact an administrator');
  return issues;
};

/**
 * Full PERA eligibility for one RFQ:
 * qualification-level lock + participant-level lock (capability & capacity match).
 */
userSchema.methods.checkRfqEligibility = function checkRfqEligibility(rfq) {
  const reasons = this.qualificationIssues();
  const { printType, totalQuantity } = rfq.designSpecs;
  if (!this.capabilities.includes(printType)) {
    reasons.push(`This RFQ requires "${printType}" capability`);
  }
  if ((this.maxCapacity || 0) < totalQuantity) {
    reasons.push(`This RFQ requires capacity for ${totalQuantity} pieces (yours: ${this.maxCapacity || 0})`);
  }
  return { eligible: reasons.length === 0, reasons };
};

/** Mongo filter for vendors who pass every PERA lock for a given print type / quantity. */
userSchema.statics.prequalifiedVendorFilter = function prequalifiedVendorFilter(printType, totalQuantity) {
  return {
    role: ROLES.VENDOR,
    isActive: true,
    isVerified: true,
    licenseExpiryDate: { $gt: new Date() },
    capabilities: printType,
    maxCapacity: { $gte: totalQuantity },
  };
};

module.exports = mongoose.model('User', userSchema);
