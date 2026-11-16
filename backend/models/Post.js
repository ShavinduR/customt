/**
 * Phase 5: a vendor's post, shown in the buyer Global Feed and on the vendor's micro-storefront.
 *
 * Platform protection (anti-disintermediation)
 *  - Title, postDescription and fabric composition pass through the same contact-info filter as the
 *    order chat BEFORE they reach MongoDB (pre-validate hook, so every save path is covered). Phone
 *    numbers, e-mails, links, messaging apps and "pay me directly" phrases become "[CONTACT BLOCKED]".
 *    The categories that were blocked are kept in `contactFlags` for admin moderation.
 *  - Images must be files uploaded to CustomT (no external links, tracking pixels or wa.me URLs).
 *  - Content fields can only change through document saves: query updates that touch them are refused,
 *    so the filter can't be bypassed with updateOne / findOneAndUpdate.
 *
 * Conditional validation
 *  - PREMIUM_CATALOG requires a size chart (unique sizes, measurements in range) and fabric specs.
 *  - CLEARANCE requires the garment type and the stock on offer (quantity and guide unit price).
 */
const mongoose = require('mongoose');
const { POST_TYPES, POSTS, SIZES, FABRICS, GSM_OPTIONS, GARMENT_TYPES, PRINT_TYPES } = require('../config/constants');
const { filterContactInfo } = require('../utils/contactFilter');
const { isUploadedFileUrl } = require('../utils/uploadUrl');
const ApiError = require('../utils/ApiError');

const { ObjectId } = mongoose.Schema.Types;
const { chestCm, lengthCm, sleeveCm } = POSTS.SIZE_CHART_RANGES;

const measurement = (label, [min, max], required = true) => ({
  type: Number,
  required: required ? [true, `${label} is required`] : false,
  min: [min, `${label} must be at least ${min} cm`],
  max: [max, `${label} must be at most ${max} cm`],
});

const sizeRowSchema = new mongoose.Schema(
  {
    size: { type: String, enum: { values: SIZES, message: `Size must be one of ${SIZES.join(', ')}` }, required: true },
    chestCm: measurement('Chest', chestCm),
    lengthCm: measurement('Length', lengthCm),
    sleeveCm: measurement('Sleeve', sleeveCm, false),
  },
  { _id: false }
);

const fabricSpecsSchema = new mongoose.Schema(
  {
    fabric: { type: String, enum: { values: FABRICS, message: `Fabric must be one of ${FABRICS.join(', ')}` }, required: [true, 'Fabric is required'] },
    gsm: { type: Number, enum: { values: GSM_OPTIONS, message: `GSM must be one of ${GSM_OPTIONS.join(', ')}` }, required: [true, 'GSM is required'] },
    composition: { type: String, trim: true, maxlength: POSTS.COMPOSITION_MAX, default: '' },
  },
  { _id: false }
);

const clearanceSchema = new mongoose.Schema(
  {
    availableQuantity: {
      type: Number,
      required: [true, 'Available quantity is required'],
      min: [1, 'Available quantity must be at least 1'],
      max: [POSTS.CLEARANCE_MAX_QUANTITY, `Available quantity must be at most ${POSTS.CLEARANCE_MAX_QUANTITY}`],
      validate: { validator: Number.isInteger, message: 'Available quantity must be a whole number' },
    },
    // A guide price only: any purchase still goes through a Direct RFQ, escrow and O2O verification.
    unitPrice: { type: Number, required: [true, 'Guide unit price is required'], min: [1, 'Guide unit price must be at least LKR 1'], max: [1000000, 'Guide unit price is too high'] },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    vendorId: { type: ObjectId, ref: 'User', required: true, index: true },
    postType: {
      type: String,
      enum: { values: POSTS.TYPES, message: `postType must be one of ${POSTS.TYPES.join(', ')}` },
      required: [true, 'postType is required'],
    },
    title: {
      type: String,
      trim: true,
      required: [true, 'Title is required'],
      minlength: [POSTS.TITLE_MIN, `Title must be at least ${POSTS.TITLE_MIN} characters`],
      maxlength: [POSTS.TITLE_MAX, `Title must be at most ${POSTS.TITLE_MAX} characters`],
    },
    postDescription: {
      type: String,
      trim: true,
      maxlength: [POSTS.DESCRIPTION_MAX, `Description must be at most ${POSTS.DESCRIPTION_MAX} characters`],
      default: '',
    },
    images: {
      type: [{ type: String, trim: true }],
      validate: [
        {
          validator: (list) => Array.isArray(list) && list.length >= POSTS.MIN_IMAGES && list.length <= POSTS.MAX_IMAGES,
          message: `Add ${POSTS.MIN_IMAGES} to ${POSTS.MAX_IMAGES} photos`,
        },
        {
          validator: (list) => (list || []).every(isUploadedFileUrl),
          message: 'Photos must be images uploaded to CustomT',
        },
      ],
    },
    garmentType: { type: String, enum: { values: GARMENT_TYPES, message: `Garment type must be one of ${GARMENT_TYPES.join(', ')}` } },
    printTypes: {
      type: [{ type: String, enum: { values: PRINT_TYPES, message: `Print type must be one of ${PRINT_TYPES.join(', ')}` } }],
      default: [],
    },
    sizeChart: { type: [sizeRowSchema], default: undefined },
    fabricSpecs: { type: fabricSpecsSchema, default: undefined },
    clearance: { type: clearanceSchema, default: undefined },

    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
    archivedAt: { type: Date },
    // Which contact-info categories were masked (phone, email, app, link...). Admin moderation only.
    contactFlags: { type: [String], default: [] },
  },
  { timestamps: true }
);

// Global Feed: newest first, stable keyset pagination on (createdAt, _id).
postSchema.index({ status: 1, createdAt: -1, _id: -1 });
postSchema.index({ status: 1, postType: 1, createdAt: -1, _id: -1 });
// Storefront tabs.
postSchema.index({ vendorId: 1, status: 1, postType: 1, createdAt: -1, _id: -1 });

/** Masks contact details in every free-text field and records what was blocked. */
function applyContactFilter(doc) {
  const flags = new Set();
  const clean = (value) => {
    if (typeof value !== 'string' || !value) return value;
    const result = filterContactInfo(value);
    result.flags.forEach((f) => flags.add(f));
    return result.text;
  };
  if (doc.isModified('title')) doc.title = clean(doc.title);
  if (doc.isModified('postDescription')) doc.postDescription = clean(doc.postDescription);
  if (doc.fabricSpecs && doc.isModified('fabricSpecs')) doc.fabricSpecs.composition = clean(doc.fabricSpecs.composition);
  if (flags.size) doc.contactFlags = [...new Set([...(doc.contactFlags || []), ...flags])];
}

/** Cross-field rules that depend on postType. */
function validateByType(doc) {
  const isPremium = doc.postType === POST_TYPES.PREMIUM_CATALOG;
  const isClearance = doc.postType === POST_TYPES.CLEARANCE;

  if (isPremium) {
    if (!Array.isArray(doc.sizeChart) || doc.sizeChart.length === 0) {
      doc.invalidate('sizeChart', 'Premium Catalog posts must include a size chart with at least one size');
    } else {
      const sizes = doc.sizeChart.map((row) => row.size);
      if (new Set(sizes).size !== sizes.length) doc.invalidate('sizeChart', 'Each size may appear only once in the size chart');
    }
    if (!doc.fabricSpecs || !doc.fabricSpecs.fabric || !doc.fabricSpecs.gsm) {
      doc.invalidate('fabricSpecs', 'Premium Catalog posts must include fabric specs (fabric and GSM)');
    }
    if (!doc.garmentType) doc.invalidate('garmentType', 'Premium Catalog posts must state the garment type');
  }

  if (isClearance) {
    if (!doc.clearance) doc.invalidate('clearance', 'Clearance posts must state the available quantity and a guide unit price');
    if (!doc.garmentType) doc.invalidate('garmentType', 'Clearance posts must state the garment type');
  } else if (doc.clearance) {
    doc.invalidate('clearance', 'Stock details are only allowed on Clearance posts');
  }
}

postSchema.pre('validate', function filterAndValidate(next) {
  applyContactFilter(this);
  validateByType(this);
  next();
});

// Content may only change through save() (which runs the filter). Status changes are allowed.
const CONTENT_FIELDS = ['title', 'postDescription', 'images', 'fabricSpecs', 'sizeChart', 'clearance', 'postType', 'vendorId', 'contactFlags'];
function touchesContent(update = {}) {
  const keys = Object.keys(update).flatMap((k) => (k.startsWith('$') ? Object.keys(update[k] || {}) : [k]));
  return keys.some((key) => CONTENT_FIELDS.some((field) => key === field || key.startsWith(`${field}.`)));
}
postSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], function guardContent(next) {
  const update = this.getUpdate ? this.getUpdate() : this.getReplacement?.();
  if (touchesContent(update || {})) {
    return next(ApiError.badRequest('Post content can only be changed by saving the post, so it passes the contact filter', { code: 'POST_CONTENT_UPDATE' }));
  }
  return next();
});

module.exports = mongoose.model('Post', postSchema);
module.exports.applyContactFilter = applyContactFilter;
