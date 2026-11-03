const express = require('express');
const { RFQ, Bid, Order } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const { protect, authorize, requirePrequalifiedVendor } = require('../middleware/auth');
const { ROLES, RFQ_STATUS, ORDER_STATUS } = require('../config/constants');
const { parsePagination } = require('../utils/helpers');
const auctionService = require('../services/auctionService');

const router = express.Router();
router.use(protect, authorize(ROLES.VENDOR));

/** GET /api/vendor/status - PERA qualification status for the dashboard banner */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const issues = req.user.qualificationIssues();
    res.json({
      success: true,
      isPrequalified: issues.length === 0,
      issues,
      isVerified: req.user.isVerified,
      licenseExpiryDate: req.user.licenseExpiryDate,
      capabilities: req.user.capabilities,
      maxCapacity: req.user.maxCapacity,
      trustScore: req.user.trustScore,
      skillBadges: req.user.skillBadges,
    });
  })
);

/**
 * GET /api/vendor/rfqs - live feed of OPEN RFQs that pass the participant-level lock
 * (capability match AND capacity >= quantity). Each item carries the vendor's own rank only.
 */
router.get(
  '/rfqs',
  requirePrequalifiedVendor,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {
      status: RFQ_STATUS.OPEN,
      expiresAt: { $gt: new Date() },
      'designSpecs.printType': { $in: req.user.capabilities },
      'designSpecs.totalQuantity': { $lte: req.user.maxCapacity },
    };
    if (req.query.printType) filter['designSpecs.printType'] = { $in: [String(req.query.printType)].filter((p) => req.user.capabilities.includes(p)) };

    const [rfqs, total] = await Promise.all([
      RFQ.find(filter).sort({ expiresAt: 1 }).skip(skip).limit(limit),
      RFQ.countDocuments(filter),
    ]);
    const myBids = await Bid.find({ vendorId: req.user._id, rfqId: { $in: rfqs.map((r) => r._id) } });
    const bidByRfq = new Map(myBids.map((b) => [String(b.rfqId), b]));

    const items = rfqs.map((rfq) => ({
      ...auctionService.publicRfqView(rfq),
      ...auctionService.buildVendorBidView(bidByRfq.get(String(rfq._id)), rfq.bidCount),
    }));
    res.json({ success: true, items, total, page, limit });
  })
);

/** GET /api/vendor/bids - bid history with own rank/outcome (no competitor data) */
router.get(
  '/bids',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { vendorId: req.user._id };
    const [bids, total] = await Promise.all([
      Bid.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).populate('rfqId'),
      Bid.countDocuments(filter),
    ]);
    const items = bids
      .filter((b) => b.rfqId)
      .map((b) => ({
        rfq: auctionService.publicRfqView(b.rfqId),
        ...auctionService.buildVendorBidView(b, b.rfqId.bidCount),
      }));
    res.json({ success: true, items, total, page, limit });
  })
);

/** GET /api/vendor/wallet - virtual balance and escrow payouts */
router.get(
  '/wallet',
  asyncHandler(async (req, res) => {
    const orders = await Order.find({ vendorId: req.user._id, 'escrowLedger.0': { $exists: true } })
      .select('orderCode escrowLedger escrowHeld escrowStatus orderStatus agreedPrice')
      .sort({ updatedAt: -1 })
      .lean();

    const transactions = orders
      .flatMap((o) =>
        o.escrowLedger
          .filter((e) => String(e.toUserId) === String(req.user._id))
          .map((e) => ({ orderId: o._id, orderCode: o.orderCode, ...e }))
      )
      .sort((a, b) => new Date(b.at) - new Date(a.at));

    const pendingInEscrow = orders
      .filter((o) => [ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.AWAITING_O2O, ORDER_STATUS.DISPUTED].includes(o.orderStatus))
      .reduce((sum, o) => sum + (o.escrowHeld || 0), 0);

    res.json({
      success: true,
      walletBalance: req.user.walletBalance,
      pendingInEscrow,
      transactions,
    });
  })
);

module.exports = router;
