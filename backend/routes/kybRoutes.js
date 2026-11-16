/**
 * Applicant side of KYB onboarding: /api/kyb
 * There are no ids in these URLs: every route acts on the caller's own application (no IDOR surface).
 */
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { protect, authorize } = require('../middleware/auth');
const { ROLES, KYB } = require('../config/constants');
const kybService = require('../services/kybService');

const router = express.Router();
router.use(protect);

// Files are held in memory, inspected, then written to private storage: never to the public /uploads disk.
const kybUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: KYB.MAX_FILE_MB * 1024 * 1024, files: 1, fields: 5 },
}).single('file');

const uploadQuota = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: KYB.UPLOADS_PER_HOUR,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { success: false, code: 'KYB_UPLOAD_QUOTA', message: `You can upload ${KYB.UPLOADS_PER_HOUR} documents per hour. Please try again later.` },
});

/** GET /api/kyb/application - status, application (if any) and the rules to show in the UI. */
router.get(
  '/application',
  authorize(ROLES.BUYER, ROLES.VENDOR),
  asyncHandler(async (req, res) => {
    res.json({ success: true, ...(await kybService.getMyApplication(req.user)) });
  })
);

/** PUT /api/kyb/application { business:{...}, owner:{ fullName, nic } } - create / update the draft. */
router.put(
  '/application',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'Application saved.', application: await kybService.saveDraft(req.user, req.body) });
  })
);

/** POST /api/kyb/application/documents (multipart: file, type, issuedOn?) */
router.post(
  '/application/documents',
  authorize(ROLES.BUYER),
  uploadQuota,
  (req, res, next) => {
    kybUpload(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return next(ApiError.badRequest(`Each file must be smaller than ${KYB.MAX_FILE_MB} MB`, { code: 'KYB_FILE_TOO_LARGE' }));
      return next(err);
    });
  },
  asyncHandler(async (req, res) => {
    const application = await kybService.uploadDocument(req.user, { type: req.body.type, issuedOn: req.body.issuedOn, file: req.file });
    res.status(201).json({ success: true, message: 'Document uploaded.', application });
  })
);

/** DELETE /api/kyb/application/documents/:docId */
router.delete(
  '/application/documents/:docId',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'Document removed.', application: await kybService.removeDocument(req.user, req.params.docId) });
  })
);

/** POST /api/kyb/application/submit { consent: true } */
router.post(
  '/application/submit',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    const application = await kybService.submit(req.user, { consent: req.body.consent === true });
    res.json({ success: true, message: 'Application submitted. An administrator will review your documents.', application });
  })
);

/** POST /api/kyb/application/withdraw */
router.post(
  '/application/withdraw',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'Application withdrawn. Your documents will be deleted.', application: await kybService.withdraw(req.user) });
  })
);

module.exports = router;
