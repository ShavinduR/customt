const express = require('express');
const { User, RFQ, Bid, Order } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { protect, authorize } = require('../middleware/auth');
const { ROLES, RFQ_STATUS, ORDER_STATUS, ESCROW_STATUS, SKILL_BADGES } = require('../config/constants');
const { parsePagination, escapeRegex, assertObjectId, round, roundMoney } = require('../utils/helpers');
const auctionService = require('../services/auctionService');
const orderService = require('../services/orderService');
const realtime = require('../services/realtime');
const chatService = require('../services/chatService');

const router = express.Router();
router.use(protect, authorize(ROLES.ADMIN));

// ───────────────────────────── Vendor verification (PERA) ─────────────────────────────

/** GET /api/admin/vendors?status=pending|verified|expired|all&search=&page=&limit= */
router.get(
  '/vendors',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { role: ROLES.VENDOR };
    const now = new Date();
    switch (req.query.status) {
      case 'pending':
        filter.isVerified = false;
        break;
      case 'verified':
        filter.isVerified = true;
        filter.licenseExpiryDate = { $gt: now };
        break;
      case 'expired':
        filter.licenseExpiryDate = { $lte: now };
        break;
      default:
        break;
    }
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).slice(0, 50)), 'i');
      filter.$or = [{ name: rx }, { companyName: rx }, { email: rx }, { businessRegNo: rx }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).sort({ isVerified: 1, createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({
      success: true,
      items: items.map((v) => ({ ...v.toJSON(), qualificationIssues: v.qualificationIssues() })),
      total,
      page,
      limit,
    });
  })
);

/** PATCH /api/admin/vendors/:id/verification { isVerified, licenseExpiryDate?, notes? } */
router.patch(
  '/vendors/:id/verification',
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'vendor id');
    const vendor = await User.findOne({ _id: req.params.id, role: ROLES.VENDOR });
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const isVerified = req.body.isVerified === true || req.body.isVerified === 'true';
    if (req.body.licenseExpiryDate !== undefined) {
      const date = new Date(req.body.licenseExpiryDate);
      if (Number.isNaN(date.getTime())) throw ApiError.badRequest('licenseExpiryDate must be a valid date');
      vendor.licenseExpiryDate = date;
    }
    if (isVerified && (!vendor.licenseExpiryDate || vendor.licenseExpiryDate.getTime() <= Date.now())) {
      throw ApiError.badRequest('A vendor can only be verified with a license expiry date in the future');
    }

    vendor.isVerified = isVerified;
    vendor.verificationNotes = typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 500) : vendor.verificationNotes;
    vendor.verifiedAt = isVerified ? new Date() : undefined;
    vendor.verifiedBy = isVerified ? req.user._id : undefined;
    await vendor.save();

    realtime.emitToUser(vendor._id, 'vendor:verification', {
      isVerified: vendor.isVerified,
      licenseExpiryDate: vendor.licenseExpiryDate,
      notes: vendor.verificationNotes,
      message: isVerified
        ? 'Congratulations! Your business is now verified and you can join eligible auction rooms.'
        : 'Your verification status has been updated. Please review the administrator notes.',
    });
    res.json({ success: true, vendor: { ...vendor.toJSON(), qualificationIssues: vendor.qualificationIssues() } });
  })
);

/** PATCH /api/admin/vendors/:id/badges { skillBadges: [...] } */
router.patch(
  '/vendors/:id/badges',
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'vendor id');
    const badges = Array.isArray(req.body.skillBadges) ? [...new Set(req.body.skillBadges.map(String))] : null;
    if (!badges) throw ApiError.badRequest('skillBadges must be an array');
    const invalid = badges.filter((b) => !SKILL_BADGES.includes(b));
    if (invalid.length) throw ApiError.badRequest(`Unknown badges: ${invalid.join(', ')}. Allowed: ${SKILL_BADGES.join(', ')}`);

    const vendor = await User.findOneAndUpdate(
      { _id: req.params.id, role: ROLES.VENDOR },
      { $set: { skillBadges: badges } },
      { new: true, runValidators: true }
    );
    if (!vendor) throw ApiError.notFound('Vendor not found');
    realtime.emitToUser(vendor._id, 'vendor:badges', { skillBadges: vendor.skillBadges });
    res.json({ success: true, vendor });
  })
);

// ───────────────────────────── User management ─────────────────────────────

/** GET /api/admin/users?role=&search=&page=&limit= */
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (Object.values(ROLES).includes(req.query.role)) filter.role = req.query.role;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).slice(0, 50)), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { companyName: rx }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, items, total, page, limit });
  })
);

/** PATCH /api/admin/users/:id/status { isActive } - suspend / reactivate */
router.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'user id');
    if (String(req.params.id) === String(req.user._id)) throw ApiError.badRequest('You cannot change your own account status');
    const isActive = req.body.isActive === true || req.body.isActive === 'true';
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { isActive } }, { new: true });
    if (!user) throw ApiError.notFound('User not found');
    if (!isActive) {
      const io = realtime.getIO();
      if (io) io.in(realtime.rooms.user(String(user._id))).disconnectSockets(true);
    }
    res.json({ success: true, user });
  })
);

// ───────────────────────────── Auction monitoring ─────────────────────────────

/** GET /api/admin/auctions/live - every OPEN auction with full leaderboard + diagnostics */
router.get(
  '/auctions/live',
  asyncHandler(async (_req, res) => {
    const rfqs = await RFQ.find({ status: RFQ_STATUS.OPEN }).sort({ expiresAt: 1 }).populate('buyerId', 'name email');
    const bids = await Bid.find({ rfqId: { $in: rfqs.map((r) => r._id) } }).populate('vendorId', 'name companyName skillBadges trustScore ratingCount');
    const bidsByRfq = bids.reduce((acc, b) => {
      const key = String(b.rfqId);
      (acc[key] = acc[key] || []).push(b);
      return acc;
    }, {});
    const items = rfqs.map((rfq) => ({
      rfq: auctionService.ownerRfqView(rfq),
      leaderboard: auctionService.buildLeaderboard(bidsByRfq[String(rfq._id)] || []),
      priceDiagnostic: rfq.priceDiagnostic,
    }));
    res.json({ success: true, items });
  })
);

/** GET /api/admin/orders?status=&page=&limit= */
router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const result = await orderService.listOrdersForUser(req.user, { status: req.query.status, ...parsePagination(req.query) });
    res.json({ success: true, ...result });
  })
);

// ───────────────────────────── Escrow disputes ─────────────────────────────

/** GET /api/admin/disputes?state=open|resolved */
router.get(
  '/disputes',
  asyncHandler(async (req, res) => {
    const filter = req.query.state === 'resolved' ? { 'dispute.resolution': { $ne: null } } : { 'dispute.isOpen': true };
    const orders = await Order.find(filter)
      .sort({ 'dispute.raisedAt': -1 })
      .populate('buyerId', 'name email phone')
      .populate('vendorId', 'name companyName email phone trustScore skillBadges');
    res.json({ success: true, items: orders.map((o) => orderService.orderView(o, req.user)) });
  })
);

/** POST /api/admin/orders/:id/resolve { resolution, vendorPercent?, notes? } */
router.post(
  '/orders/:id/resolve',
  asyncHandler(async (req, res) => {
    const order = await orderService.resolveDispute(req.user, req.params.id, req.body);
    res.json({ success: true, message: `Dispute resolved: ${order.dispute.resolution}`, order: orderService.orderView(order, req.user) });
  })
);

// ───────────────────────────── Market Intelligence Analytics ─────────────────────────────

/** GET /api/admin/conversations?flagged=true&search= - every buyer-vendor chat, newest first */
router.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const items = await chatService.listConversations({
      flaggedOnly: req.query.flagged === 'true',
      search: req.query.search || '',
    });
    res.json({ success: true, items });
  })
);

/** GET /api/admin/analytics */
router.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5, 1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const [
      usersByRole,
      vendorStats,
      rfqsByStatus,
      ordersByStatus,
      escrowTotals,
      unitPriceByPrintType,
      bidStatsPerRfq,
      monthlyTrend,
      topVendors,
      highVarianceRfqs,
      ratingStats,
    ] = await Promise.all([
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      User.aggregate([
        { $match: { role: ROLES.VENDOR } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            verified: { $sum: { $cond: [{ $and: ['$isVerified', { $gt: ['$licenseExpiryDate', new Date()] }] }, 1, 0] } },
            pending: { $sum: { $cond: ['$isVerified', 0, 1] } },
            avgTrust: { $avg: '$trustScore' },
            totalCapacity: { $sum: '$maxCapacity' },
          },
        },
      ]),
      RFQ.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Order.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { 'payment.paidAt': { $exists: true } } },
        {
          $group: {
            _id: null,
            gmv: { $sum: '$agreedPrice' },
            escrowHeld: { $sum: '$escrowHeld' },
            refunded: { $sum: '$refundedAmount' },
            paidOrders: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        { $match: { orderStatus: { $ne: ORDER_STATUS.CANCELLED } } },
        {
          $group: {
            _id: '$specSnapshot.printType',
            avgUnitPrice: { $avg: '$unitPrice' },
            minUnitPrice: { $min: '$unitPrice' },
            maxUnitPrice: { $max: '$unitPrice' },
            orders: { $sum: 1 },
            pieces: { $sum: '$specSnapshot.totalQuantity' },
          },
        },
        { $sort: { orders: -1 } },
      ]),
      Bid.aggregate([
        { $group: { _id: '$rfqId', bids: { $sum: 1 }, maxPrice: { $max: '$price' }, avgPrice: { $avg: '$price' }, revisions: { $sum: '$revisionCount' } } },
      ]),
      RFQ.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
            rfqs: { $sum: 1 },
            awarded: { $sum: { $cond: [{ $eq: ['$status', RFQ_STATUS.AWARDED] }, 1, 0] } },
            pieces: { $sum: '$designSpecs.totalQuantity' },
          },
        },
        { $sort: { '_id.y': 1, '_id.m': 1 } },
      ]),
      User.find({ role: ROLES.VENDOR, isVerified: true })
        .sort({ trustScore: -1, ratingCount: -1 })
        .limit(5)
        .select('name companyName trustScore ratingCount skillBadges walletBalance'),
      RFQ.find({ 'priceDiagnostic.highVariance': true })
        .sort({ updatedAt: -1 })
        .limit(10)
        .select('rfqCode title status priceDiagnostic designSpecs.printType designSpecs.totalQuantity'),
      Order.aggregate([
        { $match: { 'buyerRating.rating': { $exists: true } } },
        { $group: { _id: null, avgRating: { $avg: '$buyerRating.rating' }, count: { $sum: 1 } } },
      ]),
    ]);

    // Price-discovery savings: how far the accepted price sits below the highest bid on that RFQ.
    const awardedOrders = await Order.find({ orderStatus: { $ne: ORDER_STATUS.CANCELLED } }).select('rfqId agreedPrice').lean();
    const bidStatsByRfq = new Map(bidStatsPerRfq.map((b) => [String(b._id), b]));
    const savings = awardedOrders
      .map((o) => bidStatsByRfq.get(String(o.rfqId)))
      .map((stats, i) => (stats && stats.maxPrice > 0 ? (stats.maxPrice - awardedOrders[i].agreedPrice) / stats.maxPrice : null))
      .filter((v) => v !== null);

    const totalRfqsWithBids = bidStatsPerRfq.length;
    const totalBids = bidStatsPerRfq.reduce((s, b) => s + b.bids, 0);
    const totalRevisions = bidStatsPerRfq.reduce((s, b) => s + b.revisions, 0);
    const orderCounts = Object.fromEntries(ordersByStatus.map((o) => [o._id, o.count]));
    const totalOrders = Object.values(orderCounts).reduce((s, c) => s + c, 0);
    const disputedEver = await Order.countDocuments({ 'dispute.raisedAt': { $exists: true } });
    const softCloseStats = await RFQ.aggregate([{ $group: { _id: null, extensions: { $sum: '$extensionCount' }, extended: { $sum: { $cond: [{ $gt: ['$extensionCount', 0] }, 1, 0] } } } }]);
    const vendorReleased = await Order.aggregate([
      { $unwind: '$escrowLedger' },
      { $match: { 'escrowLedger.type': { $in: ['ADVANCE_RELEASE', 'FINAL_RELEASE', 'DISPUTE_RELEASE'] } } },
      { $group: { _id: null, total: { $sum: '$escrowLedger.amount' } } },
    ]);

    res.json({
      success: true,
      generatedAt: new Date(),
      users: Object.fromEntries(usersByRole.map((u) => [u._id, u.count])),
      vendors: vendorStats[0]
        ? { ...vendorStats[0], _id: undefined, avgTrust: round(vendorStats[0].avgTrust || 0, 2) }
        : { total: 0, verified: 0, pending: 0, avgTrust: 0, totalCapacity: 0 },
      rfqs: Object.fromEntries(rfqsByStatus.map((r) => [r._id, r.count])),
      orders: orderCounts,
      escrow: {
        gmv: roundMoney(escrowTotals[0]?.gmv || 0),
        currentlyHeld: roundMoney(escrowTotals[0]?.escrowHeld || 0),
        releasedToVendors: roundMoney(vendorReleased[0]?.total || 0),
        refundedToBuyers: roundMoney(escrowTotals[0]?.refunded || 0),
        paidOrders: escrowTotals[0]?.paidOrders || 0,
        frozenOrders: await Order.countDocuments({ escrowStatus: ESCROW_STATUS.FROZEN }),
      },
      auctionEfficiency: {
        avgBidsPerRfq: totalRfqsWithBids ? round(totalBids / totalRfqsWithBids, 2) : 0,
        avgRevisionsPerRfq: totalRfqsWithBids ? round(totalRevisions / totalRfqsWithBids, 2) : 0,
        avgPriceDiscoverySavingsPct: savings.length ? round((savings.reduce((s, v) => s + v, 0) / savings.length) * 100, 2) : 0,
        softCloseExtensions: softCloseStats[0]?.extensions || 0,
        rfqsExtended: softCloseStats[0]?.extended || 0,
        highVarianceRfqCount: await RFQ.countDocuments({ 'priceDiagnostic.highVariance': true }),
      },
      quality: {
        disputeRatePct: totalOrders ? round((disputedEver / totalOrders) * 100, 2) : 0,
        avgBuyerRating: round(ratingStats[0]?.avgRating || 0, 2),
        ratingsCount: ratingStats[0]?.count || 0,
      },
      unitPriceByPrintType: unitPriceByPrintType.map((p) => ({
        printType: p._id,
        avgUnitPrice: roundMoney(p.avgUnitPrice),
        minUnitPrice: roundMoney(p.minUnitPrice),
        maxUnitPrice: roundMoney(p.maxUnitPrice),
        orders: p.orders,
        pieces: p.pieces,
      })),
      monthlyTrend: monthlyTrend.map((m) => ({
        month: `${m._id.y}-${String(m._id.m).padStart(2, '0')}`,
        rfqs: m.rfqs,
        awarded: m.awarded,
        pieces: m.pieces,
      })),
      topVendors,
      highVarianceRfqs,
    });
  })
);

module.exports = router;
