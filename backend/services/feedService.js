/**
 * Phase 5: the buyer Global Feed, vendor posts and micro-storefronts.
 *
 * Only posts from vendors who currently pass the PERA qualification lock (active, verified, licence
 * valid) are shown, so a suspended or expired vendor disappears from the feed immediately.
 * Vendor contact details (phone, e-mail, business registration number) are never returned.
 * Pagination is keyset-based on (createdAt, _id): stable while new posts arrive, cheap at any depth.
 */
const mongoose = require('mongoose');
const { User, Post, Order } = require('../models');
const ApiError = require('../utils/ApiError');
const { ROLES, POSTS, POST_TYPES, ORDER_STATUS } = require('../config/constants');
const { assertObjectId, idEquals } = require('../utils/helpers');
const { filterContactInfo } = require('../utils/contactFilter');
const { isUploadedFileUrl } = require('../utils/uploadUrl');

const VENDOR_CARD_FIELDS = 'name companyName trustScore ratingCount skillBadges capabilities storefront.coverUrl';

// ───────────────────────────── Cursor pagination ─────────────────────────────

function encodeCursor(post) {
  return Buffer.from(JSON.stringify({ t: post.createdAt.getTime(), id: String(post._id) })).toString('base64url');
}

function decodeCursor(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const { t, id } = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (!Number.isFinite(t) || !mongoose.Types.ObjectId.isValid(id)) throw new Error('bad cursor');
    return { createdAt: new Date(t), _id: new mongoose.Types.ObjectId(id) };
  } catch {
    throw ApiError.badRequest('Invalid feed cursor', { code: 'INVALID_CURSOR' });
  }
}

function pageSize(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return POSTS.FEED_PAGE_SIZE;
  return Math.min(POSTS.FEED_MAX_PAGE_SIZE, Math.max(1, n));
}

function parseType(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw ApiError.badRequest(`type must be one of ${POSTS.TYPES.join(', ')}`);
    return null;
  }
  const type = String(raw).toUpperCase();
  if (!POSTS.TYPES.includes(type)) throw ApiError.badRequest(`type must be one of ${POSTS.TYPES.join(', ')}`);
  return type;
}

/** Runs a keyset-paginated, newest-first query and returns { items, nextCursor }. */
async function paginate(filter, { cursor, limit }) {
  const after = decodeCursor(cursor);
  const query = { ...filter };
  if (after) {
    query.$or = [{ createdAt: { $lt: after.createdAt } }, { createdAt: after.createdAt, _id: { $lt: after._id } }];
  }
  const size = pageSize(limit);
  const rows = await Post.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(size + 1)
    .populate('vendorId', VENDOR_CARD_FIELDS)
    .lean();
  const hasMore = rows.length > size;
  const items = hasMore ? rows.slice(0, size) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}

// ───────────────────────────── Views ─────────────────────────────

function vendorCard(vendor) {
  if (!vendor || !vendor._id) return null;
  return {
    _id: String(vendor._id),
    name: vendor.name,
    companyName: vendor.companyName || vendor.name,
    trustScore: vendor.trustScore,
    ratingCount: vendor.ratingCount || 0,
    skillBadges: vendor.skillBadges || [],
    capabilities: vendor.capabilities || [],
    coverUrl: vendor.storefront?.coverUrl || '',
  };
}

/** Public post shape. `contactFlags` is only shown to the post's vendor and to admins. */
function postView(post, viewer) {
  // A populated vendor is a plain object with a name; an unpopulated one is an ObjectId.
  const populated = post.vendorId && typeof post.vendorId === 'object' && 'name' in post.vendorId;
  const vendorId = populated ? post.vendorId._id : post.vendorId;
  const view = {
    _id: String(post._id),
    postType: post.postType,
    title: post.title,
    postDescription: post.postDescription,
    images: post.images,
    garmentType: post.garmentType || null,
    printTypes: post.printTypes || [],
    sizeChart: post.sizeChart || null,
    fabricSpecs: post.fabricSpecs || null,
    clearance: post.clearance || null,
    status: post.status,
    createdAt: post.createdAt,
    vendor: populated ? vendorCard(post.vendorId) : { _id: String(vendorId) },
  };
  if (viewer && (viewer.role === ROLES.ADMIN || idEquals(viewer._id, vendorId))) view.contactFlags = post.contactFlags || [];
  return view;
}

// ───────────────────────────── Queries ─────────────────────────────

/** Vendors who pass the PERA qualification lock right now. */
function prequalifiedVendorQuery() {
  return { role: ROLES.VENDOR, isActive: true, isVerified: true, licenseExpiryDate: { $gt: new Date() } };
}

/**
 * GET /api/posts - the Global Feed. Newest first across all prequalified vendors.
 * Query: type (optional), cursor, limit.
 */
async function listFeed(viewer, { type, cursor, limit } = {}) {
  const postType = parseType(type);
  const vendorIds = await User.find(prequalifiedVendorQuery()).distinct('_id');
  const filter = { status: 'ACTIVE', vendorId: { $in: vendorIds } };
  if (postType) filter.postType = postType;
  const { items, nextCursor } = await paginate(filter, { cursor, limit });
  return { items: items.map((p) => postView(p, viewer)), nextCursor };
}

async function getPost(viewer, postId) {
  assertObjectId(postId, 'post id');
  const post = await Post.findById(postId).populate('vendorId', `${VENDOR_CARD_FIELDS} isActive isVerified licenseExpiryDate role`).lean();
  const vendor = post?.vendorId;
  const isOwnerOrAdmin = viewer.role === ROLES.ADMIN || (vendor && idEquals(viewer._id, vendor._id));
  const visible = post && vendor && (isOwnerOrAdmin || (post.status === 'ACTIVE' && isPrequalified(vendor)));
  if (!visible) throw ApiError.notFound('Post not found');
  return postView(post, viewer);
}

function isPrequalified(vendor) {
  return (
    vendor.role === ROLES.VENDOR &&
    vendor.isActive !== false &&
    vendor.isVerified === true &&
    vendor.licenseExpiryDate instanceof Date &&
    vendor.licenseExpiryDate.getTime() > Date.now()
  );
}

/**
 * GET /api/vendors/:id/storefront - the vendor's micro-storefront.
 * Returns the public profile, post counts per tab, and one page of the selected tab (default Premium Catalog).
 */
async function getStorefront(viewer, vendorId, { type, cursor, limit } = {}) {
  assertObjectId(vendorId, 'vendor id');
  const vendor = await User.findById(vendorId);
  const isOwner = vendor && idEquals(viewer._id, vendor._id);
  if (!vendor || vendor.role !== ROLES.VENDOR || (!isPrequalified(vendor) && !isOwner && viewer.role !== ROLES.ADMIN)) {
    throw ApiError.notFound('This storefront is not available');
  }

  const tab = parseType(type) || POST_TYPES.PREMIUM_CATALOG;
  const [counts, completedOrders, page] = await Promise.all([
    Post.aggregate([{ $match: { vendorId: vendor._id, status: 'ACTIVE' } }, { $group: { _id: '$postType', count: { $sum: 1 } } }]),
    Order.countDocuments({ vendorId: vendor._id, orderStatus: ORDER_STATUS.COMPLETED }),
    paginate({ vendorId: vendor._id, status: 'ACTIVE', postType: tab }, { cursor, limit }),
  ]);
  const tabCounts = Object.fromEntries(POSTS.TYPES.map((t) => [t, 0]));
  counts.forEach((c) => {
    tabCounts[c._id] = c.count;
  });

  const prequalified = isPrequalified(vendor);
  return {
    vendor: {
      ...vendorCard(vendor),
      bio: vendor.storefront?.bio || '',
      maxCapacity: vendor.maxCapacity,
      isPrequalified: prequalified,
      memberSince: vendor.createdAt,
      completedOrders,
    },
    tabs: tabCounts,
    tab,
    items: page.items.map((p) => postView(p, viewer)),
    nextCursor: page.nextCursor,
    // The UI shows "Request Direct Quote" only when the server would accept one.
    canRequestDirectQuote: viewer.role === ROLES.BUYER && prequalified,
  };
}

// ───────────────────────────── Vendor actions ─────────────────────────────

/** Copies only the fields a vendor may set; everything else (vendorId, status, flags) is server-owned. */
function postInput(body = {}) {
  const input = {
    postType: typeof body.postType === 'string' ? body.postType.toUpperCase() : body.postType,
    title: typeof body.title === 'string' ? body.title : undefined,
    postDescription: typeof body.postDescription === 'string' ? body.postDescription : '',
    images: Array.isArray(body.images) ? body.images.map((u) => String(u)) : [],
    garmentType: body.garmentType || undefined,
    printTypes: Array.isArray(body.printTypes) ? [...new Set(body.printTypes.map(String))] : [],
  };
  if (Array.isArray(body.sizeChart)) {
    input.sizeChart = body.sizeChart.slice(0, 10).map((row) => ({
      size: row?.size,
      chestCm: Number(row?.chestCm),
      lengthCm: Number(row?.lengthCm),
      sleeveCm: row?.sleeveCm === undefined || row?.sleeveCm === null || row?.sleeveCm === '' ? undefined : Number(row.sleeveCm),
    }));
  }
  if (body.fabricSpecs && typeof body.fabricSpecs === 'object') {
    input.fabricSpecs = {
      fabric: body.fabricSpecs.fabric,
      gsm: Number(body.fabricSpecs.gsm),
      composition: typeof body.fabricSpecs.composition === 'string' ? body.fabricSpecs.composition : '',
    };
  }
  if (body.clearance && typeof body.clearance === 'object') {
    input.clearance = { availableQuantity: Number(body.clearance.availableQuantity), unitPrice: Number(body.clearance.unitPrice) };
  }
  return input;
}

/** POST /api/posts - a prequalified vendor publishes a post. */
async function createPost(vendor, body) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await Post.countDocuments({ vendorId: vendor._id, createdAt: { $gte: since } });
  if (recent >= POSTS.DAILY_LIMIT) {
    throw ApiError.tooMany(`You can publish up to ${POSTS.DAILY_LIMIT} posts per 24 hours`, { code: 'POST_DAILY_LIMIT' });
  }
  const post = new Post({ ...postInput(body), vendorId: vendor._id });
  await post.save(); // pre-validate hook masks contact details before the document is written
  await post.populate('vendorId', VENDOR_CARD_FIELDS);
  return { post: postView(post.toObject(), vendor), blocked: post.contactFlags };
}

/** DELETE /api/posts/:id - the vendor (or an admin) archives a post; it leaves the feed and storefront. */
async function archivePost(user, postId) {
  assertObjectId(postId, 'post id');
  const post = await Post.findById(postId);
  if (!post) throw ApiError.notFound('Post not found');
  if (user.role !== ROLES.ADMIN && !idEquals(post.vendorId, user._id)) throw ApiError.forbidden('You can only remove your own posts');
  if (post.status !== 'ARCHIVED') {
    post.status = 'ARCHIVED';
    post.archivedAt = new Date();
    await post.save();
  }
  return postView(post.toObject(), user);
}

/** PATCH /api/vendor/storefront { coverUrl?, bio? } - the vendor edits their storefront header. */
async function updateStorefront(vendor, { coverUrl, bio } = {}) {
  const flags = [];
  if (coverUrl !== undefined) {
    const url = String(coverUrl || '').trim();
    if (url && !isUploadedFileUrl(url, { ownerId: vendor._id, rasterOnly: true })) {
      throw ApiError.badRequest('The cover photo must be a PNG, JPG or WEBP image you uploaded to CustomT');
    }
    vendor.set('storefront.coverUrl', url);
  }
  if (bio !== undefined) {
    const raw = String(bio || '').trim();
    if (raw.length > POSTS.BIO_MAX) throw ApiError.badRequest(`The bio must be at most ${POSTS.BIO_MAX} characters`);
    const result = filterContactInfo(raw);
    flags.push(...result.flags);
    vendor.set('storefront.bio', result.text);
  }
  await vendor.save({ validateModifiedOnly: true });
  return { storefront: { coverUrl: vendor.storefront?.coverUrl || '', bio: vendor.storefront?.bio || '' }, blocked: flags };
}

module.exports = {
  listFeed,
  getPost,
  getStorefront,
  createPost,
  archivePost,
  updateStorefront,
  postView,
  encodeCursor,
  decodeCursor,
  isPrequalified,
};
