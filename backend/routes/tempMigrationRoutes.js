/**
 * TEMPORARY: lets the KYB migration run on hosts without shell access (Render free plan).
 * Remove this file and its line in server.js once the migration has been run.
 *
 *   GET /api/run-kyb-migration?secret=migrate123            -> applies the migration
 *   GET /api/run-kyb-migration?secret=migrate123&dryRun=1   -> only reports what would change
 *
 * The secret is in a public repository, which is acceptable only because the migration is idempotent
 * and changes nothing but status labels. A wrong secret gets the normal 404, so the route doesn't
 * announce itself.
 */
const crypto = require('crypto');
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { migrateKybStatuses } = require('../services/kybMigration');

const SECRET = 'migrate123';
const router = express.Router();

function secretMatches(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get(
  '/run-kyb-migration',
  asyncHandler(async (req, res, next) => {
    if (!secretMatches(req.query.secret)) return next(); // falls through to the normal 404
    const dryRun = ['1', 'true', 'yes'].includes(String(req.query.dryRun || '').toLowerCase());
    const result = await migrateKybStatuses({ apply: !dryRun });
    res.set('Cache-Control', 'no-store').json({
      success: true,
      message: dryRun ? 'Dry run: nothing was changed.' : 'KYB migration applied. Running it again changes nothing.',
      ...result,
    });
    return undefined;
  })
);

module.exports = router;
