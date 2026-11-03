/**
 * Module 1 + Module 2: RFQ lifecycle and the real-time reverse auction engine.
 */
const { User, RFQ, Bid } = require('../models');
const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');
const { ROLES, RFQ_STATUS, BID_STATUS, AUCTION } = require('../config/constants');
const { generateCode, roundMoney, idEquals, assertObjectId } = require('../utils/helpers');
const { buildDesignSpecs, calculateExpectedDeliveryDays } = require('../utils/rfqCalculator');
const { scoreBids, computePriceDiagnostic } = require('./scoringEngine');
const { auctionMutex } = require('../utils/keyedMutex');
const realtime = require('./realtime');

const VENDOR_PUBLIC_FIELDS = 'name companyName skillBadges trustScore ratingCount';

// ───────────────────────────────────────────────────────────────────────────
// View builders (Rank-Based Partial Visibility)
// ───────────────────────────────────────────────────────────────────────────

/** Full ranked leaderboard - buyer (owner) and admin only. */
function buildLeaderboard(bids) {
  const scored = scoreBids(
    bids.map((b) => ({
      id: String(b._id),
      price: b.price,
      leadTimeDays: b.leadTimeDays,
      trustScore: b.trustScoreSnapshot,
      submittedAt: b.lastSubmittedAt,
    }))
  );
  const byId = new Map(bids.map((b) => [String(b._id), b]));
  return scored.map((s) => {
    const bid = byId.get(s.id);
    const vendor = bid.vendorId && bid.vendorId._id ? bid.vendorId : null;
    return {
      bidId: s.id,
      rank: s.rank,
      score: s.score,
      scoreBreakdown: s.breakdown,
      vendorId: vendor ? String(vendor._id) : String(bid.vendorId),
      vendorName: bid.vendorName,
      companyName: bid.companyName || (vendor && vendor.companyName) || '',
      skillBadges: vendor ? vendor.skillBadges : [],
      trustScore: bid.trustScoreSnapshot,
      currentTrustScore: vendor ? vendor.trustScore : bid.trustScoreSnapshot,
      ratingCount: vendor ? vendor.ratingCount : 0,
      price: bid.price,
      unitPrice: bid.unitPrice,
      leadTimeDays: bid.leadTimeDays,
      notes: bid.notes,
      status: bid.status,
      revisionCount: bid.revisionCount,
      lastSubmittedAt: bid.lastSubmittedAt,
    };
  });
}

/** What a vendor is allowed to see: their own bid + rank. Never others' prices/identities. */
function buildVendorBidView(bid, totalBids) {
  if (!bid) return { myBid: null, rank: null, totalBids, rankLabel: null };
  return {
    myBid: {
      bidId: String(bid._id),
      price: bid.price,
      unitPrice: bid.unitPrice,
      leadTimeDays: bid.leadTimeDays,
      notes: bid.notes,
      status: bid.status,
      revisionCount: bid.revisionCount,
      revisions: (bid.revisions || []).map((r) => ({
        price: r.price,
        leadTimeDays: r.leadTimeDays,
        submittedAt: r.submittedAt,
      })),
      lastSubmittedAt: bid.lastSubmittedAt,
    },
    rank: bid.rank,
    totalBids,
    rankLabel: bid.rank ? `Your Rank: #${bid.rank} of ${totalBids}` : null,
  };
}

/** RFQ fields any eligible vendor may see (no buyer identity, no diagnostics). */
function publicRfqView(rfq) {
  return {
    _id: String(rfq._id),
    rfqCode: rfq.rfqCode,
    title: rfq.title,
    description: rfq.description,
    designSpecs: rfq.designSpecs,
    expectedDeliveryDays: rfq.expectedDeliveryDays,
    status: rfq.status,
    isLocked: rfq.isLocked,
    expiresAt: rfq.expiresAt,
    timeRemainingMs: rfq.timeRemainingMs,
    extensionCount: rfq.extensionCount,
    bidCount: rfq.bidCount,
    createdAt: rfq.createdAt,
  };
}

function ownerRfqView(rfq) {
  const obj = rfq.toJSON();
  obj.timeRemainingMs = rfq.timeRemainingMs;
  return obj;
}

async function loadBidsWithVendors(rfqId) {
  return Bid.find({ rfqId }).populate('vendorId', VENDOR_PUBLIC_FIELDS);
}

/**
 * Role-aware auction snapshot used by REST (GET /api/rfqs/:id) and Socket.IO (rfq:join).
 * Enforces access: buyer owner, admin, or a vendor who is eligible / already bid.
 */
async function getAuctionSnapshot(rfqOrId, user) {
  const rfq = rfqOrId instanceof RFQ ? rfqOrId : await findRfqOr404(rfqOrId);

  if (user.role === ROLES.ADMIN || (user.role === ROLES.BUYER && idEquals(rfq.buyerId, user._id))) {
    const bids = await loadBidsWithVendors(rfq._id);
    return {
      viewer: user.role,
      rfq: ownerRfqView(rfq),
      leaderboard: buildLeaderboard(bids),
      priceDiagnostic: rfq.priceDiagnostic,
    };
  }

  if (user.role === ROLES.VENDOR) {
    const myBid = await Bid.findOne({ rfqId: rfq._id, vendorId: user._id });
    const eligibility = user.checkRfqEligibility(rfq);
    if (!myBid && !eligibility.eligible) {
      throw ApiError.forbidden('You are not eligible for this auction room', {
        code: 'PERA_PARTICIPANT_LOCK',
        details: eligibility.reasons,
      });
    }
    return {
      viewer: ROLES.VENDOR,
      rfq: publicRfqView(rfq),
      eligibility,
      isWinner: rfq.status === RFQ_STATUS.AWARDED && idEquals(rfq.awardedVendorId, user._id),
      ...buildVendorBidView(myBid, rfq.bidCount),
    };
  }

  throw ApiError.forbidden('You do not have access to this RFQ');
}

async function findRfqOr404(rfqId) {
  assertObjectId(rfqId, 'RFQ id');
  const rfq = await RFQ.findById(rfqId);
  if (!rfq) throw ApiError.notFound('RFQ not found');
  return rfq;
}

// ───────────────────────────────────────────────────────────────────────────
// Module 1 - RFQ generation (with PERA event-level lock)
// ───────────────────────────────────────────────────────────────────────────

async function countEligibleVendors(printType, totalQuantity) {
  return User.countDocuments(User.prequalifiedVendorFilter(printType, totalQuantity));
}

/** Dry-run used by the configurator to show quantity / delivery / eligible vendor count live. */
async function previewRfq(input) {
  const designSpecs = buildDesignSpecs(input);
  const expectedDeliveryDays = calculateExpectedDeliveryDays(designSpecs);
  const eligibleVendorCount = await countEligibleVendors(designSpecs.printType, designSpecs.totalQuantity);
  return {
    designSpecs,
    totalQuantity: designSpecs.totalQuantity,
    expectedDeliveryDays,
    eligibleVendorCount,
    canLaunch: eligibleVendorCount > 0,
    auctionDurationMinutes: config.auctionDurationMinutes,
  };
}

async function createRfq(buyer, input) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 3) throw ApiError.badRequest('Please give your RFQ a title of at least 3 characters');

  const designSpecs = buildDesignSpecs(input.designSpecs || input);
  const minimumDays = calculateExpectedDeliveryDays(designSpecs);
  let expectedDeliveryDays = minimumDays;
  if (input.expectedDeliveryDays !== undefined && input.expectedDeliveryDays !== null && input.expectedDeliveryDays !== '') {
    const requested = Number(input.expectedDeliveryDays);
    if (!Number.isInteger(requested) || requested < minimumDays) {
      throw ApiError.badRequest(
        `For this specification the earliest realistic delivery is ${minimumDays} days. Choose ${minimumDays} days or more.`,
        { code: 'DELIVERY_TOO_SHORT' }
      );
    }
    expectedDeliveryDays = requested;
  }

  // PERA Event-Level Lock - no auction is launched unless a qualified supplier exists.
  const eligibleVendors = await User.find(
    User.prequalifiedVendorFilter(designSpecs.printType, designSpecs.totalQuantity),
    '_id'
  ).lean();
  if (eligibleVendors.length === 0) {
    throw ApiError.unprocessable(
      `No prequalified vendor can currently fulfil ${designSpecs.totalQuantity} pcs of ${designSpecs.printType}. ` +
        'Try a different print type or a smaller quantity.',
      { code: 'PERA_EVENT_LOCK' }
    );
  }

  const now = Date.now();
  const expiresAt = new Date(now + config.auctionDurationMinutes * 60 * 1000);
  const rfq = await RFQ.create({
    rfqCode: generateCode('RFQ'),
    buyerId: buyer._id,
    title,
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 1000) : '',
    designSpecs,
    expectedDeliveryDays,
    status: RFQ_STATUS.OPEN,
    isLocked: true,
    lockedAt: new Date(now),
    expiresAt,
    originalExpiresAt: expiresAt,
    eligibleVendorCount: eligibleVendors.length,
  });

  const announcement = { rfq: publicRfqView(rfq) };
  realtime.emitToUsers(
    eligibleVendors.map((v) => v._id),
    'rfq:new',
    announcement
  );
  realtime.emitToRole(ROLES.ADMIN, 'rfq:new', { rfq: ownerRfqView(rfq), buyerName: buyer.name });

  return rfq;
}

async function cancelRfq(buyer, rfqId, reason) {
  return auctionMutex.run(String(rfqId), async () => {
    const rfq = await findRfqOr404(rfqId);
    if (!idEquals(rfq.buyerId, buyer._id)) throw ApiError.forbidden('Only the RFQ owner can cancel it');
    if (![RFQ_STATUS.OPEN, RFQ_STATUS.CLOSED, RFQ_STATUS.EXPIRED].includes(rfq.status)) {
      throw ApiError.conflict(`An RFQ that is ${rfq.status} cannot be cancelled`);
    }
    rfq.status = RFQ_STATUS.CANCELLED;
    rfq.cancelledAt = new Date();
    rfq.cancellationReason = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
    await rfq.save();

    const payload = { rfqId: String(rfq._id), rfqCode: rfq.rfqCode, status: rfq.status };
    realtime.emitToRfqRoom(rfq._id, 'auction:closed', payload);
    const bidders = await Bid.find({ rfqId: rfq._id }).distinct('vendorId');
    realtime.emitToUsers(bidders, 'auction:closed', payload);
    realtime.emitToRole(ROLES.ADMIN, 'auction:closed', payload);
    return rfq;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Module 2 - Bidding, scoring, soft-close, broadcasting
// ───────────────────────────────────────────────────────────────────────────

function validateBidInput({ price, leadTimeDays, notes }) {
  const errors = [];
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) errors.push('price must be a positive number (total LKR for the full quantity)');
  if (numericPrice > 100000000) errors.push('price is unrealistically high');
  const lead = Number(leadTimeDays);
  if (!Number.isInteger(lead) || lead < 1 || lead > AUCTION.MAX_LEAD_TIME_DAYS) {
    errors.push(`leadTimeDays must be a whole number between 1 and ${AUCTION.MAX_LEAD_TIME_DAYS}`);
  }
  const cleanNotes = typeof notes === 'string' ? notes.trim() : '';
  if (cleanNotes.length > AUCTION.MAX_NOTES_LENGTH) errors.push(`notes must be ${AUCTION.MAX_NOTES_LENGTH} characters or fewer`);
  if (errors.length) throw ApiError.badRequest('Invalid bid', { details: errors });
  return { price: roundMoney(numericPrice), leadTimeDays: lead, notes: cleanNotes };
}

/** Recalculates score + rank for every bid on the RFQ and persists them. Call inside the RFQ mutex. */
async function recomputeRankings(rfq) {
  const bids = await loadBidsWithVendors(rfq._id);
  const scored = scoreBids(
    bids.map((b) => ({
      id: String(b._id),
      price: b.price,
      leadTimeDays: b.leadTimeDays,
      trustScore: b.trustScoreSnapshot,
      submittedAt: b.lastSubmittedAt,
    }))
  );

  if (scored.length) {
    await Bid.bulkWrite(
      scored.map((s) => ({
        updateOne: { filter: { _id: s.id }, update: { $set: { score: s.score, rank: s.rank } } },
      }))
    );
  }
  const rankById = new Map(scored.map((s) => [s.id, s]));
  bids.forEach((b) => {
    const s = rankById.get(String(b._id));
    b.score = s.score;
    b.rank = s.rank;
  });

  const diagnostic = computePriceDiagnostic(bids.map((b) => b.price));
  rfq.bidCount = bids.length;
  rfq.priceDiagnostic = { ...diagnostic, evaluatedAt: new Date() };
  await rfq.save();

  return { bids, diagnostic };
}

/** Pushes role-appropriate state to every party. Leaderboard NEVER goes to the shared rfq room. */
function broadcastAuctionState(rfq, bids) {
  const rfqId = String(rfq._id);
  const leaderboard = buildLeaderboard(bids);
  const ownerPayload = {
    rfqId,
    rfqCode: rfq.rfqCode,
    status: rfq.status,
    expiresAt: rfq.expiresAt,
    extensionCount: rfq.extensionCount,
    bidCount: bids.length,
    leaderboard,
    priceDiagnostic: rfq.priceDiagnostic,
  };
  realtime.emitToUser(rfq.buyerId, 'auction:leaderboard', ownerPayload);
  realtime.emitToRole(ROLES.ADMIN, 'auction:leaderboard', ownerPayload);

  bids.forEach((bid) => {
    realtime.emitToUser(bid.vendorId._id || bid.vendorId, 'auction:rank', {
      rfqId,
      rfqCode: rfq.rfqCode,
      status: rfq.status,
      expiresAt: rfq.expiresAt,
      ...buildVendorBidView(bid, bids.length),
    });
  });

  realtime.emitToRfqRoom(rfqId, 'auction:activity', {
    rfqId,
    status: rfq.status,
    bidCount: bids.length,
    expiresAt: rfq.expiresAt,
    extensionCount: rfq.extensionCount,
    at: new Date(),
  });
}

/**
 * Place a new bid or revise an existing one (multi-round re-bidding).
 * Shared by REST (POST /api/rfqs/:id/bids) and Socket.IO (bid:place).
 */
async function placeBid(vendorId, rfqId, input) {
  assertObjectId(rfqId, 'RFQ id');
  const clean = validateBidInput(input || {});

  return auctionMutex.run(String(rfqId), async () => {
    const [rfq, vendor] = await Promise.all([RFQ.findById(rfqId), User.findById(vendorId)]);
    if (!rfq) throw ApiError.notFound('RFQ not found');
    if (!vendor) throw ApiError.unauthorized('Vendor account not found');

    const now = Date.now();
    if (rfq.status !== RFQ_STATUS.OPEN || rfq.expiresAt.getTime() <= now) {
      throw ApiError.conflict('This auction is closed for bidding', { code: 'AUCTION_CLOSED' });
    }

    const eligibility = vendor.checkRfqEligibility(rfq);
    if (!eligibility.eligible) {
      throw ApiError.forbidden('You are not eligible to bid on this RFQ', {
        code: vendor.qualificationIssues().length ? 'PERA_QUALIFICATION_LOCK' : 'PERA_PARTICIPANT_LOCK',
        details: eligibility.reasons,
      });
    }

    const unitPrice = roundMoney(clean.price / rfq.designSpecs.totalQuantity);
    let bid = await Bid.findOne({ rfqId: rfq._id, vendorId: vendor._id });
    let isRevision = false;

    if (bid) {
      const unchanged =
        bid.price === clean.price && bid.leadTimeDays === clean.leadTimeDays && bid.notes === clean.notes;
      if (unchanged) throw ApiError.badRequest('Your bid is unchanged - adjust the price, lead time or notes to re-bid');
      if (!config.allowBidPriceIncrease && clean.price > bid.price) {
        throw ApiError.badRequest(
          `In a reverse auction a re-bid cannot raise your price (current: LKR ${bid.price.toFixed(2)})`,
          { code: 'PRICE_INCREASE_NOT_ALLOWED' }
        );
      }
      bid.revisions.push({
        price: bid.price,
        leadTimeDays: bid.leadTimeDays,
        notes: bid.notes,
        rankBefore: bid.rank,
        submittedAt: bid.lastSubmittedAt,
      });
      bid.revisionCount += 1;
      Object.assign(bid, clean, {
        unitPrice,
        trustScoreSnapshot: vendor.trustScore,
        vendorName: vendor.name,
        companyName: vendor.companyName,
        lastSubmittedAt: new Date(now),
      });
      await bid.save();
      isRevision = true;
    } else {
      bid = await Bid.create({
        rfqId: rfq._id,
        vendorId: vendor._id,
        vendorName: vendor.name,
        companyName: vendor.companyName,
        ...clean,
        unitPrice,
        trustScoreSnapshot: vendor.trustScore,
        lastSubmittedAt: new Date(now),
      });
    }

    // Soft-close: activity in the final 2 minutes extends the auction by 5 minutes.
    let extended = false;
    if (rfq.expiresAt.getTime() - now <= AUCTION.SOFT_CLOSE_WINDOW_MS) {
      rfq.expiresAt = new Date(rfq.expiresAt.getTime() + AUCTION.SOFT_CLOSE_EXTENSION_MS);
      rfq.extensionCount += 1;
      extended = true;
    }

    const { bids } = await recomputeRankings(rfq);
    broadcastAuctionState(rfq, bids);

    if (extended) {
      const extensionPayload = {
        rfqId: String(rfq._id),
        expiresAt: rfq.expiresAt,
        extensionCount: rfq.extensionCount,
        extendedByMs: AUCTION.SOFT_CLOSE_EXTENSION_MS,
        message: 'Late bid received — auction extended by 5 minutes (soft-close).',
      };
      realtime.emitToRfqRoom(rfq._id, 'auction:extended', extensionPayload);
      realtime.emitToUser(rfq.buyerId, 'auction:extended', extensionPayload);
      realtime.emitToRole(ROLES.ADMIN, 'auction:extended', extensionPayload);
    }

    const myBid = bids.find((b) => idEquals(b._id, bid._id));
    return {
      isRevision,
      extended,
      expiresAt: rfq.expiresAt,
      rfqId: String(rfq._id),
      ...buildVendorBidView(myBid, bids.length),
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Auction expiry scheduler
// ───────────────────────────────────────────────────────────────────────────

async function closeExpiredAuctions() {
  const due = await RFQ.find({ status: RFQ_STATUS.OPEN, expiresAt: { $lte: new Date() } }, '_id').limit(100).lean();
  for (const { _id } of due) {
    // eslint-disable-next-line no-await-in-loop
    await auctionMutex.run(String(_id), async () => {
      const rfq = await RFQ.findById(_id);
      if (!rfq || rfq.status !== RFQ_STATUS.OPEN || rfq.expiresAt.getTime() > Date.now()) return;
      rfq.status = rfq.bidCount > 0 ? RFQ_STATUS.CLOSED : RFQ_STATUS.EXPIRED;
      rfq.closedAt = new Date();
      await rfq.save();

      const bids = await loadBidsWithVendors(rfq._id);
      broadcastAuctionState(rfq, bids);
      const payload = {
        rfqId: String(rfq._id),
        rfqCode: rfq.rfqCode,
        status: rfq.status,
        message:
          rfq.status === RFQ_STATUS.CLOSED
            ? 'Bidding has ended. The buyer is reviewing the ranked bids.'
            : 'The auction ended without any bids.',
      };
      realtime.emitToRfqRoom(rfq._id, 'auction:ended', payload);
      realtime.emitToUser(rfq.buyerId, 'auction:ended', payload);
      realtime.emitToRole(ROLES.ADMIN, 'auction:ended', payload);
    });
  }
  return due.length;
}

let schedulerHandle = null;

function startAuctionScheduler() {
  if (schedulerHandle) return;
  const tick = () =>
    closeExpiredAuctions().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[auction-scheduler] failed:', err.message);
    });
  tick();
  schedulerHandle = setInterval(tick, config.auctionSchedulerIntervalMs);
  if (schedulerHandle.unref) schedulerHandle.unref();
}

function stopAuctionScheduler() {
  if (schedulerHandle) clearInterval(schedulerHandle);
  schedulerHandle = null;
}

/** Bids are frozen once the auction ends: mark winner / non-winners. Used by orderService. */
async function settleBidsForAward(rfqId, winningBidId) {
  await Bid.updateOne({ _id: winningBidId }, { $set: { status: BID_STATUS.ACCEPTED } });
  await Bid.updateMany({ rfqId, _id: { $ne: winningBidId } }, { $set: { status: BID_STATUS.REJECTED } });
}

module.exports = {
  buildLeaderboard,
  buildVendorBidView,
  publicRfqView,
  ownerRfqView,
  getAuctionSnapshot,
  findRfqOr404,
  countEligibleVendors,
  previewRfq,
  createRfq,
  cancelRfq,
  placeBid,
  recomputeRankings,
  broadcastAuctionState,
  closeExpiredAuctions,
  startAuctionScheduler,
  stopAuctionScheduler,
  settleBidsForAward,
  loadBidsWithVendors,
};
