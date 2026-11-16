/**
 * Admin review of KYB applications: /api/admin/vendor-applications (admins only).
 * Every document view is written to the KybAccessLog.
 */
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const { parsePagination } = require('../utils/helpers');
const kybService = require('../services/kybService');

const router = express.Router();
router.use(protect, authorize(ROLES.ADMIN));

/** GET /?status=PENDING_APPROVAL,CHANGES_REQUESTED&page=&limit= */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit } = parsePagination(req.query);
    res.json({ success: true, ...(await kybService.adminList({ status: req.query.status || 'PENDING_APPROVAL', page, limit })) });
  })
);

/** GET /:id - full application, documents (without storage locations), risk flags, history. */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ success: true, application: await kybService.adminGet(req.params.id) });
  })
);

/** GET /:id/documents/:docId - streams the file (inline viewer). Logged. */
router.get(
  '/:id/documents/:docId',
  asyncHandler(async (req, res) => {
    await kybService.streamDocument(req.user, req.params.id, req.params.docId, req, res);
  })
);

/** GET /:id/documents/:docId/link - 60-second presigned Cloudflare R2 link (new tab). Logged. */
router.get(
  '/:id/documents/:docId/link',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ success: true, ...(await kybService.documentLink(req.user, req.params.id, req.params.docId, req)) });
  })
);

/** POST /:id/documents/:docId/review { status: ACCEPTED|REJECTED, reason? } */
router.post(
  '/:id/documents/:docId/review',
  asyncHandler(async (req, res) => {
    res.json({ success: true, application: await kybService.reviewDocument(req.user, req.params.id, req.params.docId, req.body) });
  })
);

/** POST /:id/decision { outcome: APPROVED|CHANGES_REQUESTED|REJECTED, notes? } */
router.post(
  '/:id/decision',
  asyncHandler(async (req, res) => {
    const application = await kybService.decide(req.user, req.params.id, req.body);
    res.json({ success: true, message: `Application ${application.status.replace(/_/g, ' ').toLowerCase()}.`, application });
  })
);

module.exports = router;
