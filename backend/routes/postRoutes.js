const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const { protect, authorize, requirePrequalifiedVendor } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const feedService = require('../services/feedService');

const router = express.Router();
router.use(protect);

// Burst protection on publishing (the 24-hour quota is enforced in the service).
const publishLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { success: false, message: 'You are publishing too quickly. Please wait a minute.' },
});

/**
 * GET /api/posts?type=PREMIUM_CATALOG|INSPIRATION|CLEARANCE&cursor=&limit=
 * Global Feed: newest posts from every prequalified vendor. Infinite scroll: pass back `nextCursor`
 * until it is null.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await feedService.listFeed(req.user, req.query)) });
  })
);

/** GET /api/posts/:id - one post (deep link). */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ success: true, post: await feedService.getPost(req.user, req.params.id) });
  })
);

/**
 * POST /api/posts (prequalified vendor)
 * { postType, title, postDescription?, images[1-6], garmentType?, printTypes?,
 *   sizeChart?[{ size, chestCm, lengthCm, sleeveCm? }], fabricSpecs?{ fabric, gsm, composition? },
 *   clearance?{ availableQuantity, unitPrice } }
 * PREMIUM_CATALOG requires sizeChart + fabricSpecs + garmentType; CLEARANCE requires clearance + garmentType.
 * Contact details in the text are replaced with "[CONTACT BLOCKED]" before saving; `blocked` lists what was masked.
 */
router.post(
  '/',
  authorize(ROLES.VENDOR),
  requirePrequalifiedVendor,
  publishLimiter,
  asyncHandler(async (req, res) => {
    const { post, blocked } = await feedService.createPost(req.user, req.body);
    res.status(201).json({
      success: true,
      message: blocked.length
        ? 'Post published. Contact details were removed: buyers reach you through Direct Quotes, protected by escrow.'
        : 'Post published to the Global Feed.',
      post,
      blocked,
    });
  })
);

/** DELETE /api/posts/:id - archive (vendor: own posts; admin: any post, for moderation). */
router.delete(
  '/:id',
  authorize(ROLES.VENDOR, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'Post removed.', post: await feedService.archivePost(req.user, req.params.id) });
  })
);

module.exports = router;
