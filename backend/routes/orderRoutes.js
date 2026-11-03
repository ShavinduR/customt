const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const { parsePagination } = require('../utils/helpers');
const orderService = require('../services/orderService');

const router = express.Router();
router.use(protect);

const send = (res, req, order, message, extra = {}) =>
  res.json({ success: true, message, order: orderService.orderView(order, req.user), ...extra });

/** GET /api/orders?status=IN_PROGRESS,AWAITING_O2O&page=&limit= (scoped to caller's role) */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await orderService.listOrdersForUser(req.user, { status: req.query.status, ...parsePagination(req.query) });
    res.json({ success: true, ...result });
  })
);

/** GET /api/orders/:id */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await orderService.loadOrderForUser(req.params.id, req.user, { populate: true });
    res.json({ success: true, order: orderService.orderView(order, req.user) });
  })
);

/** POST /api/orders/:id/pay { cardNumber, cardHolder, expiry:"MM/YY", cvv } (buyer) - locks funds in escrow */
router.post(
  '/:id/pay',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    const { order, receipt } = await orderService.fundEscrow(req.user, req.params.id, req.body);
    send(res, req, order, 'Payment successful. Funds are now held securely in CustomT escrow.', { receipt });
  })
);

/** POST /api/orders/:id/cancel (buyer, only before payment) */
router.post(
  '/:id/cancel',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    const order = await orderService.cancelPendingOrder(req.user, req.params.id);
    send(res, req, order, 'Order cancelled.');
  })
);

/**
 * PATCH /api/orders/:id/production { status, note? } (vendor)
 * NOT_STARTED -> MATERIAL_SOURCED -> IN_PRODUCTION (30% advance released) -> READY_FOR_INSPECTION (O2O PIN issued)
 */
router.patch(
  '/:id/production',
  authorize(ROLES.VENDOR),
  asyncHandler(async (req, res) => {
    const order = await orderService.advanceProduction(req.user, req.params.id, req.body.status, req.body.note);
    send(res, req, order, `Production status updated to ${order.productionStatus}.`);
  })
);

/** GET /api/orders/:id/o2o (buyer) - 6-digit PIN + QR code (buyer-only visibility) */
router.get(
  '/:id/o2o',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    res.json({ success: true, o2o: await orderService.getO2OPin(req.user, req.params.id) });
  })
);

/** POST /api/orders/:id/o2o/regenerate (buyer) - issue a fresh PIN and reset attempts */
router.post(
  '/:id/o2o/regenerate',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'A new O2O PIN has been generated.', o2o: await orderService.regenerateO2OPin(req.user, req.params.id) });
  })
);

/** POST /api/orders/:id/o2o/verify { pin } (vendor) - correct PIN releases the final 70% */
router.post(
  '/:id/o2o/verify',
  authorize(ROLES.VENDOR),
  asyncHandler(async (req, res) => {
    const order = await orderService.verifyO2OPin(req.user, req.params.id, req.body.pin);
    send(res, req, order, `O2O verified. LKR ${order.finalAmount.toFixed(2)} final settlement released to your wallet.`);
  })
);

/** POST /api/orders/:id/o2o/approve (buyer) - approve inspection without the PIN hand-over */
router.post(
  '/:id/o2o/approve',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    const order = await orderService.buyerApproveInspection(req.user, req.params.id);
    send(res, req, order, 'Inspection approved and final payment released. Please rate your vendor.');
  })
);

/** POST /api/orders/:id/rate { rating:1-5, review? } (buyer) - EWMA trust update */
router.post(
  '/:id/rate',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    const { order, trustBefore, trustAfter } = await orderService.rateVendor(req.user, req.params.id, req.body);
    send(res, req, order, 'Thank you for your feedback!', { trustBefore, trustAfter });
  })
);

/** POST /api/orders/:id/dispute { category, description, desiredResolution, evidenceUrls? } (buyer) - freezes escrow */
router.post(
  '/:id/dispute',
  authorize(ROLES.BUYER),
  asyncHandler(async (req, res) => {
    const order = await orderService.raiseDispute(req.user, req.params.id, req.body);
    send(res, req, order, 'We are sorry about this experience. Your dispute has been logged and escrow is frozen.');
  })
);

/** POST /api/orders/:id/dispute/notes { message } (buyer, vendor or admin) */
router.post(
  '/:id/dispute/notes',
  asyncHandler(async (req, res) => {
    const note = await orderService.addDisputeNote(req.user, req.params.id, req.body.message);
    res.status(201).json({ success: true, note });
  })
);

module.exports = router;
