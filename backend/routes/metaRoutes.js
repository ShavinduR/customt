const express = require('express');
const mongoose = require('mongoose');
const { config } = require('../config/env');
const C = require('../config/constants');

const router = express.Router();

/** GET /api/meta/health (also mounted at /api/health) */
function health(_req, res) {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const db = states[mongoose.connection.readyState] || 'unknown';
  res.status(db === 'connected' ? 200 : 503).json({
    success: db === 'connected',
    service: 'customt-api',
    db,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date(),
  });
}
router.get('/health', health);

/** GET /api/meta/catalog - every option the frontend configurator & forms need. */
router.get('/catalog', (_req, res) => {
  res.json({
    success: true,
    garmentTypes: C.GARMENT_TYPES,
    fabrics: C.FABRICS,
    gsmOptions: C.GSM_OPTIONS,
    printTypes: C.PRINT_TYPES,
    printPlacements: C.PRINT_PLACEMENTS,
    design: C.DESIGN,
    sizes: C.SIZES,
    skillBadges: C.SKILL_BADGES,
    minOrderQuantity: C.MIN_ORDER_QUANTITY,
    deliveryEstimation: C.DELIVERY_ESTIMATION,
    auction: {
      durationMinutes: config.auctionDurationMinutes,
      softCloseWindowMs: C.AUCTION.SOFT_CLOSE_WINDOW_MS,
      softCloseExtensionMs: C.AUCTION.SOFT_CLOSE_EXTENSION_MS,
      weights: C.AUCTION.WEIGHTS,
      priceCvThreshold: C.AUCTION.PRICE_CV_THRESHOLD,
      maxLeadTimeDays: C.AUCTION.MAX_LEAD_TIME_DAYS,
      allowPriceIncrease: config.allowBidPriceIncrease,
    },
    escrow: {
      advanceRatio: C.ESCROW.ADVANCE_RATIO,
      finalRatio: C.ESCROW.FINAL_RATIO,
      o2oPinLength: C.ESCROW.O2O_PIN_LENGTH,
      o2oMaxAttempts: C.ESCROW.O2O_MAX_ATTEMPTS,
    },
    statuses: {
      rfq: C.RFQ_STATUS,
      order: C.ORDER_STATUS,
      escrow: C.ESCROW_STATUS,
      production: C.PRODUCTION_STATUS,
      productionFlow: C.PRODUCTION_FLOW,
    },
    disputeCategories: C.DISPUTE_CATEGORIES,
    disputeDesiredResolutions: C.DISPUTE_DESIRED_RESOLUTIONS,
    disputeResolutions: C.DISPUTE_RESOLUTIONS,
    testCards: [
      { number: '4242 4242 4242 4242', outcome: 'Approved (Visa)' },
      { number: '5555 5555 5555 4444', outcome: 'Approved (Mastercard)' },
      { number: '4000 0000 0000 0002', outcome: 'Declined' },
      { number: '4000 0000 0000 9995', outcome: 'Insufficient funds' },
    ],
  });
});

module.exports = router;
module.exports.health = health;
