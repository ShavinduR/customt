const express = require('express');
const { RFQ, Bid } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { protect, authorize, requirePrequalifiedVendor } = require('../middleware/auth');
const { ROLES, RFQ_STATUS } = require('../config/constants');
const { parsePagination, escapeRegex } = require('../utils/helpers');
const auctionService = require('../services/auctionService');
const orderService = require('../services/orderService');
const { CPAPO_MESSAGE } = require('../models/RFQ');

const router = express.Router();
router.use(protect);

/**
 * POST /api/rfqs/preview  (buyer)
 * Live configurator feedback: totalQuantity, expectedDeliveryDays, eligible vendor count.
 */
router.post(
  '/preview',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    res.json({ success: true, preview: await auctionService.previewRfq(req.body.designSpecs || req.body) });
  })
);

/**
 * POST /api/rfqs  (buyer)
 * { title, description?, expectedDeliveryDays?, designSpecs: { garmentType, fabric, gsm, color, printType,
 *   printPlacement?, customText?, backText?, textColor?, logoUrl?, designPosition?, sizeBreakdown:{S,M,L,XL,XXL} } }
 */
router.post(
  '/',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    const rfq = await auctionService.createRfq(req.user, req.body);
    res.status(201).json({
      success: true,
      message: `RFQ ${rfq.rfqCode} is live. ${rfq.eligibleVendorCount} prequalified vendor(s) have been notified.`,
      rfq: auctionService.ownerRfqView(rfq),
    });
  })
);

/**
 * GET /api/rfqs
 * buyer  -> own RFQs | vendor -> RFQs they are eligible for or bid on | admin -> all
 * Query: status (comma list), search, page, limit
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.status) {
      const statuses = String(req.query.status).split(',').filter((s) => Object.values(RFQ_STATUS).includes(s));
      if (statuses.length) filter.status = { $in: statuses };
    }
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).slice(0, 50)), 'i');
      filter.$or = [{ title: rx }, { rfqCode: rx }];
    }

    if (req.user.role === ROLES.BUYER) {
      filter.buyerId = req.user._id;
    } else if (req.user.role === ROLES.VENDOR) {
      // Vendors use /api/vendor/rfqs for the eligible feed; here they see the RFQs they bid on.
      filter._id = { $in: await Bid.find({ vendorId: req.user._id }).distinct('rfqId') };
    }

    const [items, total] = await Promise.all([
      RFQ.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      RFQ.countDocuments(filter),
    ]);
    const view = req.user.role === ROLES.VENDOR ? auctionService.publicRfqView : auctionService.ownerRfqView;
    res.json({ success: true, items: items.map(view), total, page, limit });
  })
);

/** GET /api/rfqs/:id - role-aware auction snapshot (buyer/admin: leaderboard, vendor: own rank only). */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await auctionService.getAuctionSnapshot(req.params.id, req.user)) });
  })
);

/** PUT/PATCH /api/rfqs/:id - always rejected: specs are locked (CPAPO mitigation). */
router.put('/:id', authorize(ROLES.BUYER), (_req, _res, next) => next(ApiError.locked(CPAPO_MESSAGE, { code: 'CPAPO_SPEC_LOCK' })));
router.patch('/:id', authorize(ROLES.BUYER), (_req, _res, next) => next(ApiError.locked(CPAPO_MESSAGE, { code: 'CPAPO_SPEC_LOCK' })));

/** POST /api/rfqs/:id/cancel { reason? } (buyer, before award) */
router.post(
  '/:id/cancel',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    const rfq = await auctionService.cancelRfq(req.user, req.params.id, req.body.reason);
    res.json({ success: true, message: 'RFQ cancelled', rfq: auctionService.ownerRfqView(rfq) });
  })
);

/** POST /api/rfqs/:id/bids { price, leadTimeDays, notes? } - place or revise a bid (vendor). */
router.post(
  '/:id/bids',
  authorize(ROLES.VENDOR),
  requirePrequalifiedVendor,
  asyncHandler(async (req, res) => {
    const result = await auctionService.placeBid(req.user._id, req.params.id, req.body);
    res.status(result.isRevision ? 200 : 201).json({
      success: true,
      message: result.extended
        ? `Bid recorded. ${result.rankLabel}. Soft-close triggered: auction extended by 5 minutes.`
        : `Bid recorded. ${result.rankLabel}.`,
      ...result,
    });
  })
);

/** POST /api/rfqs/:id/bids/:bidId/accept - buyer awards the auction and creates the Order. */
router.post(
  '/:id/bids/:bidId/accept',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    const order = await orderService.acceptBid(req.user, req.params.id, req.params.bidId);
    res.status(201).json({
      success: true,
      message: `Bid accepted. Order ${order.orderCode} created - please fund escrow to start production.`,
      order: orderService.orderView(order, req.user),
    });
  })
);

module.exports = router;
