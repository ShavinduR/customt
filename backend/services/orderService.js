/**
 * Module 3: Bid acceptance, split-payment escrow, production milestones,
 * O2O physical verification, trust-score EWMA and Politeness-CRM disputes.
 */
const QRCode = require('qrcode');
const { User, RFQ, Bid, Order } = require('../models');
const ApiError = require('../utils/ApiError');
const {
  ROLES,
  RFQ_STATUS,
  ORDER_STATUS,
  ESCROW_STATUS,
  PRODUCTION_STATUS,
  PRODUCTION_FLOW,
  ESCROW,
  TRUST,
  DISPUTE_CATEGORIES,
  DISPUTE_DESIRED_RESOLUTIONS,
  DISPUTE_RESOLUTIONS,
} = require('../config/constants');
const { generateCode, generateNumericPin, safeEqual, roundMoney, round, idEquals, assertObjectId } = require('../utils/helpers');
const { KeyedMutex, auctionMutex } = require('../utils/keyedMutex');
const politeness = require('../utils/politenessTemplates');
const paymentGateway = require('./mockPaymentGateway');
const auctionService = require('./auctionService');
const realtime = require('./realtime');

const orderMutex = new KeyedMutex();
const withOrderLock = (orderId, task) => orderMutex.run(`order_${orderId}`, task);

const BUYER_POPULATE = { path: 'buyerId', select: 'name email phone' };
const VENDOR_POPULATE = { path: 'vendorId', select: 'name companyName email phone trustScore ratingCount skillBadges' };

// ───────────────────────────────────────────────────────────────────────────
// Views & access
// ───────────────────────────────────────────────────────────────────────────

function viewerRole(order, user) {
  if (user.role === ROLES.ADMIN) return ROLES.ADMIN;
  if (user.role === ROLES.BUYER && idEquals(order.buyerId, user._id)) return ROLES.BUYER;
  if (user.role === ROLES.VENDOR && idEquals(order.vendorId, user._id)) return ROLES.VENDOR;
  return null;
}

function orderView(order, user) {
  const role = viewerRole(order, user);
  const obj = order.toJSON();
  delete obj.o2oPin;
  delete obj.__v;
  obj.disputeNotes = (obj.disputeNotes || []).filter((note) => role === ROLES.ADMIN || note.audience === 'all' || note.audience === role);
  obj.nextProductionStep = PRODUCTION_FLOW[order.productionStatus] || null;
  obj.o2oAttemptsRemaining = Math.max(0, ESCROW.O2O_MAX_ATTEMPTS - (order.o2oAttempts || 0));
  obj.canRate = role === ROLES.BUYER && order.orderStatus === ORDER_STATUS.COMPLETED && !order.buyerRating?.rating;
  if (role === ROLES.VENDOR && obj.dispute) delete obj.dispute.description; // vendor sees softened template only
  return obj;
}

async function loadOrderForUser(orderId, user, { withPin = false, populate = false } = {}) {
  assertObjectId(orderId, 'order id');
  let query = Order.findById(orderId);
  if (withPin) query = query.select('+o2oPin');
  if (populate) query = query.populate(BUYER_POPULATE).populate(VENDOR_POPULATE);
  const order = await query;
  if (!order) throw ApiError.notFound('Order not found');
  if (!viewerRole(order, user)) throw ApiError.forbidden('You are not a party to this order');
  return order;
}

function notifyOrderParties(order, event, extra = {}) {
  const payload = { orderId: String(order._id), orderCode: order.orderCode, orderStatus: order.orderStatus, escrowStatus: order.escrowStatus, productionStatus: order.productionStatus, ...extra };
  const buyerId = order.buyerId?._id || order.buyerId;
  const vendorId = order.vendorId?._id || order.vendorId;
  realtime.emitToUser(buyerId, event, payload);
  realtime.emitToUser(vendorId, event, payload);
  realtime.emitToRole(ROLES.ADMIN, event, payload);
}

async function buildO2OQr(order, pin) {
  return QRCode.toDataURL(JSON.stringify({ type: 'CUSTOMT_O2O', orderCode: order.orderCode, pin }), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Bid acceptance -> Order
// ───────────────────────────────────────────────────────────────────────────

async function acceptBid(buyer, rfqId, bidId) {
  assertObjectId(rfqId, 'RFQ id');
  assertObjectId(bidId, 'bid id');

  return auctionMutex.run(String(rfqId), async () => {
    const rfq = await RFQ.findById(rfqId);
    if (!rfq) throw ApiError.notFound('RFQ not found');
    if (!idEquals(rfq.buyerId, buyer._id)) throw ApiError.forbidden('Only the RFQ owner can accept a bid');
    if (![RFQ_STATUS.OPEN, RFQ_STATUS.CLOSED].includes(rfq.status)) {
      throw ApiError.conflict(`Bids cannot be accepted on an RFQ that is ${rfq.status}`);
    }

    const bid = await Bid.findOne({ _id: bidId, rfqId: rfq._id });
    if (!bid) throw ApiError.notFound('Bid not found on this RFQ');

    const vendor = await User.findById(bid.vendorId);
    if (!vendor || vendor.qualificationIssues().length) {
      throw ApiError.conflict('This vendor is no longer prequalified on CustomT. Please choose another bid.', {
        code: 'VENDOR_NOT_QUALIFIED',
      });
    }

    const advanceAmount = roundMoney(bid.price * ESCROW.ADVANCE_RATIO);
    const finalAmount = roundMoney(bid.price - advanceAmount);
    const now = new Date();

    const order = await Order.create({
      orderCode: generateCode('ORD'),
      rfqId: rfq._id,
      buyerId: rfq.buyerId,
      vendorId: vendor._id,
      bidId: bid._id,
      specSnapshot: {
        title: rfq.title,
        rfqCode: rfq.rfqCode,
        garmentType: rfq.designSpecs.garmentType,
        fabric: rfq.designSpecs.fabric,
        gsm: rfq.designSpecs.gsm,
        printType: rfq.designSpecs.printType,
        totalQuantity: rfq.designSpecs.totalQuantity,
      },
      agreedPrice: bid.price,
      unitPrice: bid.unitPrice,
      leadTimeDays: bid.leadTimeDays,
      advanceAmount,
      finalAmount,
      productionTimeline: [{ status: 'ORDER_CREATED', note: `Bid accepted (rank #${bid.rank})`, actorId: buyer._id, at: now }],
    });

    try {
      rfq.status = RFQ_STATUS.AWARDED;
      rfq.awardedBidId = bid._id;
      rfq.awardedVendorId = vendor._id;
      rfq.orderId = order._id;
      rfq.awardedAt = now;
      rfq.closedAt = rfq.closedAt || now;
      await rfq.save();
    } catch (err) {
      await Order.deleteOne({ _id: order._id });
      throw err;
    }

    await auctionService.settleBidsForAward(rfq._id, bid._id);
    const bids = await auctionService.loadBidsWithVendors(rfq._id);
    auctionService.broadcastAuctionState(rfq, bids);

    const base = { rfqId: String(rfq._id), rfqCode: rfq.rfqCode, status: rfq.status };
    realtime.emitToUser(vendor._id, 'auction:awarded', {
      ...base,
      orderId: String(order._id),
      orderCode: order.orderCode,
      agreedPrice: order.agreedPrice,
      message: `Congratulations! Your bid for "${rfq.title}" was accepted. Production can begin once the buyer funds escrow.`,
    });
    const losers = bids.filter((b) => !idEquals(b._id, bid._id)).map((b) => b.vendorId._id || b.vendorId);
    realtime.emitToUsers(losers, 'auction:lost', {
      ...base,
      message: `The buyer has awarded "${rfq.title}" to another vendor. Thank you for participating.`,
    });
    realtime.emitToRfqRoom(rfq._id, 'auction:closed', base);
    realtime.emitToUser(rfq.buyerId, 'order:created', { ...base, orderId: String(order._id), orderCode: order.orderCode });
    realtime.emitToRole(ROLES.ADMIN, 'order:created', { ...base, orderId: String(order._id), orderCode: order.orderCode });

    return order;
  });
}

async function cancelPendingOrder(buyer, orderId) {
  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, buyer);
    if (!idEquals(order.buyerId, buyer._id)) throw ApiError.forbidden('Only the buyer can cancel this order');
    if (order.orderStatus !== ORDER_STATUS.PENDING_ESCROW) {
      throw ApiError.conflict('Only orders awaiting escrow payment can be cancelled. Funded orders must go through dispute resolution.');
    }
    order.orderStatus = ORDER_STATUS.CANCELLED;
    order.cancelledAt = new Date();
    order.productionTimeline.push({ status: 'CANCELLED', note: 'Cancelled by buyer before escrow funding', actorId: buyer._id });
    await order.save();
    await RFQ.updateOne({ _id: order.rfqId }, { $set: { status: RFQ_STATUS.CANCELLED, cancelledAt: new Date(), cancellationReason: 'Order cancelled before payment' } });
    notifyOrderParties(order, 'order:updated', { message: 'The buyer cancelled this order before funding escrow.' });
    return order;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Escrow funding (mock gateway)
// ───────────────────────────────────────────────────────────────────────────

async function fundEscrow(buyer, orderId, card) {
  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, buyer);
    if (!idEquals(order.buyerId, buyer._id)) throw ApiError.forbidden('Only the buyer can fund escrow');
    if (order.orderStatus !== ORDER_STATUS.PENDING_ESCROW || order.escrowStatus !== ESCROW_STATUS.AWAITING_PAYMENT) {
      throw ApiError.conflict('Escrow for this order has already been funded or the order is no longer active');
    }

    const receipt = await paymentGateway.charge({ amount: order.agreedPrice, card, reference: order.orderCode });

    order.payment = {
      transactionRef: receipt.transactionRef,
      method: 'CARD',
      cardBrand: receipt.brand,
      cardLast4: receipt.last4,
      amount: receipt.amount,
      paidAt: receipt.processedAt,
    };
    order.escrowHeld = order.agreedPrice;
    order.escrowStatus = ESCROW_STATUS.ESCROW_LOCKED;
    order.orderStatus = ORDER_STATUS.IN_PROGRESS;
    order.escrowLedger.push({ type: 'ESCROW_DEPOSIT', amount: order.agreedPrice, reference: receipt.transactionRef, note: 'Buyer funded escrow' });
    order.productionTimeline.push({ status: 'ESCROW_LOCKED', note: `LKR ${order.agreedPrice.toFixed(2)} locked in escrow`, actorId: buyer._id });
    await order.save();

    notifyOrderParties(order, 'order:updated', {
      message: 'Escrow funded. The vendor can now source materials and begin production.',
    });
    return { order, receipt };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Production milestones (30% advance on IN_PRODUCTION, PIN on READY_FOR_INSPECTION)
// ───────────────────────────────────────────────────────────────────────────

async function advanceProduction(vendor, orderId, nextStatus, note = '') {
  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, vendor, { withPin: true });
    if (!idEquals(order.vendorId, vendor._id)) throw ApiError.forbidden('Only the assigned vendor can update production');
    if (order.escrowStatus === ESCROW_STATUS.FROZEN) {
      throw ApiError.locked('Production updates are paused while a dispute is open', { code: 'ESCROW_FROZEN' });
    }
    if (order.orderStatus !== ORDER_STATUS.IN_PROGRESS) {
      throw ApiError.conflict(
        order.orderStatus === ORDER_STATUS.PENDING_ESCROW
          ? 'Production cannot start until the buyer funds escrow'
          : `Production cannot be updated while the order is ${order.orderStatus}`
      );
    }

    const expected = PRODUCTION_FLOW[order.productionStatus];
    if (!expected || nextStatus !== expected) {
      throw ApiError.badRequest(
        expected ? `The next production step must be ${expected}` : 'No further production steps are available',
        { code: 'INVALID_PRODUCTION_TRANSITION' }
      );
    }

    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 300) : '';
    order.productionStatus = nextStatus;
    order.productionTimeline.push({ status: nextStatus, note: cleanNote, actorId: vendor._id });
    let message = `Production update: ${nextStatus.replace(/_/g, ' ').toLowerCase()}.`;
    let pin = null;

    if (nextStatus === PRODUCTION_STATUS.IN_PRODUCTION && !order.advanceReleased) {
      // Milestone 1 - release the 30% booking advance.
      await User.updateOne({ _id: order.vendorId }, { $inc: { walletBalance: order.advanceAmount } });
      order.advanceReleased = true;
      order.advanceReleasedAt = new Date();
      order.escrowHeld = roundMoney(order.escrowHeld - order.advanceAmount);
      order.escrowStatus = ESCROW_STATUS.PARTIALLY_RELEASED;
      order.escrowLedger.push({ type: 'ADVANCE_RELEASE', amount: order.advanceAmount, toUserId: order.vendorId, note: '30% booking advance (Milestone 1)' });
      message = `Production started. 30% advance (LKR ${order.advanceAmount.toFixed(2)}) released to the vendor.`;
    }

    if (nextStatus === PRODUCTION_STATUS.READY_FOR_INSPECTION) {
      pin = generateNumericPin(ESCROW.O2O_PIN_LENGTH);
      order.o2oPin = pin;
      order.o2oPinGeneratedAt = new Date();
      order.o2oAttempts = 0;
      order.orderStatus = ORDER_STATUS.AWAITING_O2O;
      message = 'Your order is ready for physical inspection. Share the O2O PIN with the vendor only after you are satisfied.';
    }

    await order.save();
    notifyOrderParties(order, 'order:updated', { message });

    if (pin) {
      const qrDataUrl = await buildO2OQr(order, pin);
      realtime.emitToUser(order.buyerId, 'o2o:ready', {
        orderId: String(order._id),
        orderCode: order.orderCode,
        pin,
        qrDataUrl,
        message,
      });
    }
    return order;
  });
}

async function getO2OPin(buyer, orderId) {
  const order = await loadOrderForUser(orderId, buyer, { withPin: true });
  if (!idEquals(order.buyerId, buyer._id)) throw ApiError.forbidden('Only the buyer can view the O2O PIN');
  if (!order.o2oPin || ![ORDER_STATUS.AWAITING_O2O, ORDER_STATUS.DISPUTED].includes(order.orderStatus)) {
    throw ApiError.conflict('An O2O PIN is only available once the vendor marks the order ready for inspection');
  }
  return {
    orderId: String(order._id),
    orderCode: order.orderCode,
    pin: order.o2oPin,
    qrDataUrl: await buildO2OQr(order, order.o2oPin),
    generatedAt: order.o2oPinGeneratedAt,
    attemptsUsed: order.o2oAttempts,
    attemptsRemaining: Math.max(0, ESCROW.O2O_MAX_ATTEMPTS - order.o2oAttempts),
    frozen: order.escrowStatus === ESCROW_STATUS.FROZEN,
  };
}

async function regenerateO2OPin(buyer, orderId) {
  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, buyer, { withPin: true });
    if (!idEquals(order.buyerId, buyer._id)) throw ApiError.forbidden('Only the buyer can regenerate the O2O PIN');
    if (order.orderStatus !== ORDER_STATUS.AWAITING_O2O) throw ApiError.conflict('The order is not awaiting O2O verification');
    order.o2oPin = generateNumericPin(ESCROW.O2O_PIN_LENGTH);
    order.o2oPinGeneratedAt = new Date();
    order.o2oAttempts = 0;
    order.productionTimeline.push({ status: 'O2O_PIN_REGENERATED', actorId: buyer._id });
    await order.save();
    realtime.emitToUser(order.vendorId, 'order:updated', {
      orderId: String(order._id),
      orderCode: order.orderCode,
      orderStatus: order.orderStatus,
      message: 'The buyer generated a new O2O PIN. Previous PINs are no longer valid.',
    });
    return getO2OPin(buyer, orderId);
  });
}

/** Milestone 2 - release the remaining 70% and complete the order. Call inside the order lock. */
async function completeOrder(order, method, actorId) {
  const amount = order.escrowHeld;
  await User.updateOne({ _id: order.vendorId }, { $inc: { walletBalance: amount } });
  const now = new Date();
  order.escrowLedger.push({ type: 'FINAL_RELEASE', amount, toUserId: order.vendorId, note: `70% final settlement via ${method}` });
  order.escrowHeld = 0;
  order.finalReleased = true;
  order.finalReleasedAt = now;
  order.escrowStatus = ESCROW_STATUS.FUNDS_RELEASED;
  order.orderStatus = ORDER_STATUS.COMPLETED;
  order.productionStatus = PRODUCTION_STATUS.DELIVERED;
  order.o2oVerifiedAt = now;
  order.o2oMethod = method;
  order.o2oPin = undefined;
  order.completedAt = now;
  order.productionTimeline.push({ status: 'DELIVERED', note: `O2O verified (${method})`, actorId });
  await order.save();

  realtime.emitToUser(order.buyerId, 'order:completed', {
    orderId: String(order._id),
    orderCode: order.orderCode,
    promptRating: true,
    message: 'Inspection verified and funds released. Please take a moment to rate your vendor.',
  });
  realtime.emitToUser(order.vendorId, 'order:completed', {
    orderId: String(order._id),
    orderCode: order.orderCode,
    amountCredited: amount,
    message: `O2O verification successful. LKR ${amount.toFixed(2)} (final 70%) has been credited to your wallet.`,
  });
  realtime.emitToRole(ROLES.ADMIN, 'order:completed', { orderId: String(order._id), orderCode: order.orderCode });
  return order;
}

function assertAwaitingO2O(order) {
  if (order.escrowStatus === ESCROW_STATUS.FROZEN) {
    throw ApiError.locked('Escrow is frozen while a dispute is open', { code: 'ESCROW_FROZEN' });
  }
  if (order.orderStatus !== ORDER_STATUS.AWAITING_O2O || order.productionStatus !== PRODUCTION_STATUS.READY_FOR_INSPECTION) {
    throw ApiError.conflict('This order is not awaiting O2O inspection');
  }
}

async function verifyO2OPin(vendor, orderId, pin) {
  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, vendor, { withPin: true });
    if (!idEquals(order.vendorId, vendor._id)) throw ApiError.forbidden('Only the assigned vendor can submit the O2O PIN');
    assertAwaitingO2O(order);

    if (order.o2oAttempts >= ESCROW.O2O_MAX_ATTEMPTS) {
      throw ApiError.tooMany('Too many incorrect PIN attempts. Ask the buyer to generate a new PIN.', { code: 'O2O_PIN_LOCKED' });
    }
    const cleanPin = String(pin || '').trim();
    if (!/^\d{6}$/.test(cleanPin)) throw ApiError.badRequest('The O2O PIN must be exactly 6 digits');

    if (!safeEqual(cleanPin, order.o2oPin)) {
      order.o2oAttempts += 1;
      await order.save();
      const remaining = Math.max(0, ESCROW.O2O_MAX_ATTEMPTS - order.o2oAttempts);
      realtime.emitToUser(order.buyerId, 'o2o:failed-attempt', {
        orderId: String(order._id),
        orderCode: order.orderCode,
        attemptsRemaining: remaining,
        message: 'An incorrect O2O PIN was entered by the vendor.',
      });
      throw ApiError.badRequest(`Incorrect PIN. ${remaining} attempt(s) remaining.`, {
        code: 'O2O_PIN_INVALID',
        details: { attemptsRemaining: remaining },
      });
    }

    return completeOrder(order, 'PIN', vendor._id);
  });
}

async function buyerApproveInspection(buyer, orderId) {
  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, buyer, { withPin: true });
    if (!idEquals(order.buyerId, buyer._id)) throw ApiError.forbidden('Only the buyer can approve the inspection');
    assertAwaitingO2O(order);
    return completeOrder(order, 'BUYER_APPROVAL', buyer._id);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Rating -> Trust Score (EWMA)
// ───────────────────────────────────────────────────────────────────────────

function nextTrustScore(oldTrust, rating) {
  const raw = TRUST.EWMA_OLD_WEIGHT * oldTrust + TRUST.EWMA_NEW_WEIGHT * rating;
  return Math.min(TRUST.MAX, Math.max(TRUST.MIN, round(raw, 2)));
}

async function rateVendor(buyer, orderId, { rating, review }) {
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 5) throw ApiError.badRequest('Rating must be a whole number from 1 to 5');

  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, buyer);
    if (!idEquals(order.buyerId, buyer._id)) throw ApiError.forbidden('Only the buyer can rate this order');
    if (order.orderStatus !== ORDER_STATUS.COMPLETED) throw ApiError.conflict('You can rate the vendor once the order is completed');
    if (order.buyerRating && order.buyerRating.rating) throw ApiError.conflict('You have already rated this order');

    // Serialise trust updates per vendor so concurrent ratings never overwrite each other.
    return orderMutex.run(`trust_${order.vendorId}`, async () => {
      const vendor = await User.findById(order.vendorId);
      if (!vendor) throw ApiError.notFound('Vendor not found');
      const trustBefore = vendor.trustScore;
      const trustAfter = nextTrustScore(trustBefore, value);
      await User.updateOne({ _id: vendor._id }, { $set: { trustScore: trustAfter }, $inc: { ratingCount: 1 } });

      order.buyerRating = {
        rating: value,
        review: typeof review === 'string' ? review.trim().slice(0, 1000) : '',
        trustBefore,
        trustAfter,
        ratedAt: new Date(),
      };
      await order.save();

      realtime.emitToUser(vendor._id, 'vendor:trust-updated', {
        orderId: String(order._id),
        orderCode: order.orderCode,
        rating: value,
        trustScore: trustAfter,
        previousTrustScore: trustBefore,
      });
      return { order, trustBefore, trustAfter };
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Disputes (Politeness CRM)
// ───────────────────────────────────────────────────────────────────────────

function validateEvidence(urls) {
  if (urls === undefined || urls === null) return [];
  if (!Array.isArray(urls) || urls.length > 5) throw ApiError.badRequest('Provide up to 5 evidence URLs');
  return urls.map((u) => {
    const s = String(u).trim();
    if (!/^(https?:\/\/|\/uploads\/)/i.test(s)) throw ApiError.badRequest(`Invalid evidence URL: ${s}`);
    return s;
  });
}

async function raiseDispute(buyer, orderId, { category, description, desiredResolution, evidenceUrls }) {
  if (!Object.keys(DISPUTE_CATEGORIES).includes(category)) {
    throw ApiError.badRequest(`category must be one of: ${Object.keys(DISPUTE_CATEGORIES).join(', ')}`);
  }
  if (!DISPUTE_DESIRED_RESOLUTIONS.includes(desiredResolution)) {
    throw ApiError.badRequest(`desiredResolution must be one of: ${DISPUTE_DESIRED_RESOLUTIONS.join(', ')}`);
  }
  const text = typeof description === 'string' ? description.trim() : '';
  if (text.length < 20 || text.length > 2000) {
    throw ApiError.badRequest('Please describe the issue in 20 to 2000 characters so the mediator can help');
  }
  const evidence = validateEvidence(evidenceUrls);

  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, buyer, { populate: true });
    if (!idEquals(order.buyerId, buyer._id)) throw ApiError.forbidden('Only the buyer can raise a dispute');
    if (order.dispute?.isOpen) throw ApiError.conflict('A dispute is already open for this order');
    if (
      ![ESCROW_STATUS.ESCROW_LOCKED, ESCROW_STATUS.PARTIALLY_RELEASED].includes(order.escrowStatus) ||
      ![ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.AWAITING_O2O].includes(order.orderStatus)
    ) {
      throw ApiError.conflict('Disputes can only be raised while funds are held in escrow');
    }

    const tone = politeness.analyseTone(text);
    const vendorName = order.vendorId.companyName || order.vendorId.name;
    const ctx = {
      buyerName: order.buyerId.name,
      vendorName,
      orderCode: order.orderCode,
      rfqCode: order.specSnapshot.rfqCode,
      category,
      description: text,
      desiredResolution,
      escrowHeld: order.escrowHeld,
      tone,
    };

    order.dispute = {
      isOpen: true,
      category,
      desiredResolution,
      description: text,
      evidenceUrls: evidence,
      toneFlagged: tone.isHostile,
      raisedAt: new Date(),
      previousEscrowStatus: order.escrowStatus,
      previousOrderStatus: order.orderStatus,
      resolution: null,
    };
    order.escrowStatus = ESCROW_STATUS.FROZEN;
    order.orderStatus = ORDER_STATUS.DISPUTED;
    order.productionTimeline.push({ status: 'DISPUTE_RAISED', note: politeness.categoryLabel(category), actorId: buyer._id });

    const acknowledgement = politeness.buyerAcknowledgement(ctx);
    const vendorMessage = politeness.vendorNotification(ctx);
    order.disputeNotes.push(
      { authorRole: 'system', audience: 'buyer', template: 'BUYER_ACKNOWLEDGEMENT', message: acknowledgement },
      { authorRole: 'system', audience: 'vendor', template: 'VENDOR_NOTIFICATION', message: vendorMessage },
      { authorRole: 'system', audience: 'admin', template: 'ADMIN_CASE_SUMMARY', message: politeness.adminCaseSummary(ctx) }
    );
    await order.save();

    const base = { orderId: String(order._id), orderCode: order.orderCode, escrowStatus: order.escrowStatus, orderStatus: order.orderStatus };
    realtime.emitToUser(order.buyerId._id, 'dispute:raised', { ...base, message: acknowledgement });
    realtime.emitToUser(order.vendorId._id, 'dispute:raised', { ...base, message: vendorMessage });
    realtime.emitToRole(ROLES.ADMIN, 'dispute:new', { ...base, category, toneFlagged: tone.isHostile, escrowHeld: order.escrowHeld });
    return order;
  });
}

async function addDisputeNote(user, orderId, message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text.length < 2 || text.length > 1000) throw ApiError.badRequest('Message must be 2 to 1000 characters');

  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, user);
    if (!order.dispute?.isOpen) throw ApiError.conflict('There is no open dispute on this order');
    const note = {
      authorId: user._id,
      authorRole: user.role,
      audience: 'all',
      template: 'FOLLOW_UP',
      message: politeness.followUpNote({ authorName: user.companyName || user.name, authorRole: user.role, message: text }),
    };
    order.disputeNotes.push(note);
    await order.save();
    const saved = order.disputeNotes[order.disputeNotes.length - 1];
    notifyOrderParties(order, 'dispute:note', { note: saved });
    return saved;
  });
}

async function resolveDispute(admin, orderId, { resolution, vendorPercent, notes }) {
  if (!Object.values(DISPUTE_RESOLUTIONS).includes(resolution)) {
    throw ApiError.badRequest(`resolution must be one of: ${Object.values(DISPUTE_RESOLUTIONS).join(', ')}`);
  }
  const adminNotes = typeof notes === 'string' ? notes.trim().slice(0, 1000) : '';

  return withOrderLock(orderId, async () => {
    const order = await loadOrderForUser(orderId, admin, { withPin: true, populate: true });
    if (!order.dispute?.isOpen) throw ApiError.conflict('There is no open dispute on this order');

    const held = order.escrowHeld;
    const buyerId = order.buyerId._id;
    const vendorId = order.vendorId._id;
    let vendorAmount = 0;
    let buyerAmount = 0;
    const now = new Date();

    switch (resolution) {
      case DISPUTE_RESOLUTIONS.RELEASE_TO_VENDOR:
        vendorAmount = held;
        order.escrowStatus = ESCROW_STATUS.FUNDS_RELEASED;
        order.orderStatus = ORDER_STATUS.COMPLETED;
        break;
      case DISPUTE_RESOLUTIONS.REFUND_BUYER:
        buyerAmount = held;
        order.escrowStatus = ESCROW_STATUS.REFUNDED;
        order.orderStatus = ORDER_STATUS.REFUNDED;
        break;
      case DISPUTE_RESOLUTIONS.SPLIT: {
        const pct = Number(vendorPercent);
        if (!Number.isInteger(pct) || pct < 1 || pct > 99) throw ApiError.badRequest('vendorPercent must be a whole number from 1 to 99');
        vendorAmount = roundMoney((held * pct) / 100);
        buyerAmount = roundMoney(held - vendorAmount);
        order.escrowStatus = ESCROW_STATUS.SPLIT_SETTLED;
        order.orderStatus = ORDER_STATUS.COMPLETED;
        break;
      }
      case DISPUTE_RESOLUTIONS.RESUME_PRODUCTION:
        order.escrowStatus = order.dispute.previousEscrowStatus;
        if (order.productionStatus === PRODUCTION_STATUS.READY_FOR_INSPECTION) {
          // Remedy = reprint: go back to production and invalidate the old PIN.
          order.productionStatus = PRODUCTION_STATUS.IN_PRODUCTION;
          order.orderStatus = ORDER_STATUS.IN_PROGRESS;
          order.o2oPin = undefined;
          order.o2oAttempts = 0;
          order.productionTimeline.push({ status: PRODUCTION_STATUS.IN_PRODUCTION, note: 'Reprint agreed in mediation', actorId: admin._id });
        } else {
          order.orderStatus = order.dispute.previousOrderStatus;
        }
        break;
      default:
        break;
    }

    if (vendorAmount > 0) {
      await User.updateOne({ _id: vendorId }, { $inc: { walletBalance: vendorAmount } });
      order.escrowLedger.push({ type: 'DISPUTE_RELEASE', amount: vendorAmount, toUserId: vendorId, note: `Dispute resolution: ${resolution}` });
    }
    if (buyerAmount > 0) {
      await User.updateOne({ _id: buyerId }, { $inc: { walletBalance: buyerAmount } });
      order.escrowLedger.push({ type: 'REFUND', amount: buyerAmount, toUserId: buyerId, note: `Dispute resolution: ${resolution}` });
      order.refundedAmount = roundMoney((order.refundedAmount || 0) + buyerAmount);
    }
    if (resolution !== DISPUTE_RESOLUTIONS.RESUME_PRODUCTION) {
      order.escrowHeld = 0;
      order.finalReleased = vendorAmount > 0;
      order.finalReleasedAt = vendorAmount > 0 ? now : undefined;
      order.o2oPin = undefined;
      order.o2oMethod = 'ADMIN_RESOLUTION';
      order.completedAt = now;
      order.productionTimeline.push({ status: `DISPUTE_${resolution}`, note: adminNotes, actorId: admin._id });
    }

    order.dispute.isOpen = false;
    order.dispute.resolution = resolution;
    order.dispute.resolutionNotes = adminNotes;
    order.dispute.vendorAmount = vendorAmount;
    order.dispute.buyerAmount = buyerAmount;
    order.dispute.resolvedAt = now;
    order.dispute.resolvedBy = admin._id;

    const msgCtx = { orderCode: order.orderCode, resolution, buyerAmount, vendorAmount, adminNotes };
    const buyerMsg = politeness.resolutionMessage({ ...msgCtx, recipientName: order.buyerId.name });
    const vendorMsg = politeness.resolutionMessage({ ...msgCtx, recipientName: order.vendorId.companyName || order.vendorId.name });
    order.disputeNotes.push(
      { authorId: admin._id, authorRole: ROLES.ADMIN, audience: 'buyer', template: 'RESOLUTION', message: buyerMsg },
      { authorId: admin._id, authorRole: ROLES.ADMIN, audience: 'vendor', template: 'RESOLUTION', message: vendorMsg }
    );
    await order.save();

    const base = { orderId: String(order._id), orderCode: order.orderCode, resolution, orderStatus: order.orderStatus, escrowStatus: order.escrowStatus };
    realtime.emitToUser(buyerId, 'dispute:resolved', { ...base, message: buyerMsg, promptRating: order.orderStatus === ORDER_STATUS.COMPLETED });
    realtime.emitToUser(vendorId, 'dispute:resolved', { ...base, message: vendorMsg });
    realtime.emitToRole(ROLES.ADMIN, 'dispute:resolved', base);
    return order;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Queries
// ───────────────────────────────────────────────────────────────────────────

async function listOrdersForUser(user, { status, page, limit, skip }) {
  const filter = {};
  if (user.role === ROLES.BUYER) filter.buyerId = user._id;
  if (user.role === ROLES.VENDOR) filter.vendorId = user._id;
  if (status) {
    const statuses = String(status).split(',').filter((s) => Object.values(ORDER_STATUS).includes(s));
    if (statuses.length) filter.orderStatus = { $in: statuses };
  }
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(BUYER_POPULATE).populate(VENDOR_POPULATE),
    Order.countDocuments(filter),
  ]);
  return { items: items.map((o) => orderView(o, user)), total, page, limit };
}

module.exports = {
  orderView,
  loadOrderForUser,
  acceptBid,
  cancelPendingOrder,
  fundEscrow,
  advanceProduction,
  getO2OPin,
  regenerateO2OPin,
  verifyO2OPin,
  buyerApproveInspection,
  nextTrustScore,
  rateVendor,
  raiseDispute,
  addDisputeNote,
  resolveDispute,
  listOrdersForUser,
};
