const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const feedService = require('../services/feedService');

const router = express.Router();
router.use(protect);

/**
 * GET /api/vendors/:id/storefront?type=PREMIUM_CATALOG|INSPIRATION|CLEARANCE&cursor=&limit=
 * Public micro-storefront: profile (no contact details), trust score, badges, post counts per tab and
 * one page of the selected tab. `canRequestDirectQuote` tells the UI whether to show the button.
 */
router.get(
  '/:id/storefront',
  asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await feedService.getStorefront(req.user, req.params.id, req.query)) });
  })
);

module.exports = router;
