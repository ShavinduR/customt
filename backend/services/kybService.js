/**
 * KYB (Know Your Business) vendor onboarding.
 *
 * Single-role model: every account starts as a buyer. A buyer submits a VendorApplication with business
 * details and four kinds of evidence (BR copy, NIC, utility bill, past invoices). Only an administrator
 * can approve it, and only the approval below changes `role` from buyer to vendor.
 *
 * Security rules (see docs/SECURITY_AUDIT_PHASE5.md):
 *  - Applicant operations never take an application id: they always act on the caller's own application.
 *  - Status changes go through `transition()` and an explicit table of allowed moves and actors.
 *  - role / vendorStatus / isVerified are never copied from a request body.
 *  - Documents are inspected (real type, risky PDFs refused, images re-encoded) and stored privately;
 *    every admin view is logged.
 */
const { User, VendorApplication, KybAccessLog } = require('../models');
const ApiError = require('../utils/ApiError');
const { ROLES, KYB, PRINT_TYPES, VENDOR_STATUS } = require('../config/constants');
const { assertObjectId, idEquals } = require('../utils/helpers');
const { containsContactInfo } = require('../utils/contactFilter');
const { isValidNic, nicFingerprint, nicLast4 } = require('../utils/nic');
const { inspectDocument } = require('../utils/fileInspect');
const storage = require('./kybStorage');
const realtime = require('./realtime');

const OPEN = ['DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED'];
const EDITABLE = ['DRAFT', 'CHANGES_REQUESTED'];
const DAY = 24 * 60 * 60 * 1000;

// ───────────────────────────── State machine ─────────────────────────────

/** from -> { to: actor } : the only status changes that exist. */
const TRANSITIONS = {
  DRAFT: { PENDING_APPROVAL: 'applicant', WITHDRAWN: 'applicant' },
  PENDING_APPROVAL: { APPROVED: 'admin', CHANGES_REQUESTED: 'admin', REJECTED: 'admin', WITHDRAWN: 'applicant' },
  CHANGES_REQUESTED: { PENDING_APPROVAL: 'applicant', WITHDRAWN: 'applicant' },
};

/** Mirrors the application status onto the user (what the UI shows). */
const USER_STATUS = {
  DRAFT: VENDOR_STATUS.DRAFT,
  PENDING_APPROVAL: VENDOR_STATUS.PENDING_APPROVAL,
  CHANGES_REQUESTED: VENDOR_STATUS.CHANGES_REQUESTED,
  APPROVED: VENDOR_STATUS.APPROVED,
  REJECTED: VENDOR_STATUS.REJECTED,
  WITHDRAWN: VENDOR_STATUS.NONE,
};

function transition(application, to, { actor, actorId, note = '' }) {
  const allowedActor = TRANSITIONS[application.status]?.[to];
  if (!allowedActor) {
    throw ApiError.conflict(`An application that is ${application.status} cannot become ${to}`, { code: 'KYB_INVALID_TRANSITION' });
  }
  if (allowedActor !== actor) throw ApiError.forbidden(`Only the ${allowedActor} can make this change`, { code: 'KYB_FORBIDDEN_TRANSITION' });
  application.status = to;
  application.history.push({ status: to, actorId, actorRole: actor, note: String(note).slice(0, 500) });
}

// ───────────────────────────── Submission rules (pure, unit-tested) ─────────────────────────────

function monthsAgo(n, from = new Date()) {
  const d = new Date(from);
  d.setMonth(d.getMonth() - n);
  return d;
}

/**
 * Returns the list of problems that stop an application from being submitted (empty = ready).
 * Used both to show the applicant a checklist and to enforce submission on the server.
 */
function submissionProblems(application, now = new Date()) {
  const problems = [];
  const b = application.business || {};
  const o = application.owner || {};
  if (!b.legalName) problems.push('Enter the legal business name.');
  if (!b.businessRegNo) problems.push('Enter the business registration (BR) number.');
  if (!b.address?.line1 || !b.address?.city || !b.address?.district) problems.push('Enter the registered business address (street, city and district).');
  if (!b.capabilities?.length) problems.push('Choose at least one printing method you offer.');
  if (!(b.maxCapacity >= 1)) problems.push('Enter your maximum capacity per order (pieces).');
  if (!b.licenseExpiryDate || new Date(b.licenseExpiryDate) <= now) problems.push('Enter a business licence expiry date in the future.');
  if (!o.fullName) problems.push("Enter the owner's full name as on the NIC.");
  if (!o.nicLast4) problems.push("Enter the owner's NIC number.");

  const docs = application.documents || [];
  const of = (type) => docs.filter((d) => d.type === type);
  if (of('BR_COPY').length !== 1) problems.push('Upload the Business Registration (BR) copy.');
  const front = of('NIC_FRONT');
  if (front.length !== 1) problems.push('Upload the front of the NIC.');
  else if (front[0].mimeType !== 'application/pdf' && of('NIC_BACK').length !== 1) problems.push('Upload the back of the NIC (or one PDF with both sides as the front).');

  const bills = of('UTILITY_BILL');
  if (bills.length !== 1) problems.push('Upload one utility bill as proof of location.');
  else if (!bills[0].issuedOn || new Date(bills[0].issuedOn) < monthsAgo(KYB.UTILITY_BILL_MAX_AGE_MONTHS, now)) {
    problems.push(`The utility bill must be dated within the last ${KYB.UTILITY_BILL_MAX_AGE_MONTHS} months.`);
  }

  const invoices = of('PAST_INVOICE');
  if (invoices.length < KYB.INVOICES_MIN) problems.push(`Upload at least ${KYB.INVOICES_MIN} past business invoices (you have ${invoices.length}).`);
  const windowStart = monthsAgo(KYB.INVOICE_WINDOW_MONTHS, now);
  const inWindow = invoices.filter((d) => d.issuedOn && new Date(d.issuedOn) >= windowStart && new Date(d.issuedOn) <= now);
  if (invoices.length && inWindow.length < KYB.INVOICES_MIN) {
    problems.push(`At least ${KYB.INVOICES_MIN} invoices must be dated within the last ${KYB.INVOICE_WINDOW_MONTHS} months.`);
  }
  const months = new Set(inWindow.map((d) => new Date(d.issuedOn).toISOString().slice(0, 7)));
  if (inWindow.length >= KYB.INVOICES_MIN && months.size < KYB.INVOICE_MIN_DISTINCT_MONTHS) {
    problems.push(`Invoices must come from at least ${KYB.INVOICE_MIN_DISTINCT_MONTHS} different months, to show ongoing trading.`);
  }
  return problems;
}

// ───────────────────────────── Views ─────────────────────────────

function documentView(doc) {
  return {
    _id: String(doc._id),
    type: doc.type,
    label: KYB.DOC_LABELS[doc.type],
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    issuedOn: doc.issuedOn || null,
    uploadedAt: doc.uploadedAt,
    review: { status: doc.review?.status || 'PENDING', reason: doc.review?.reason || '' },
  };
}

/** What the applicant sees: no storage keys, no NIC hash, no risk flags, no reviewer identities. */
function applicantView(app, now = new Date()) {
  if (!app) return null;
  const business = app.toObject({ depopulate: true }).business || {};
  return {
    _id: String(app._id),
    status: app.status,
    submissionCount: app.submissionCount,
    business,
    owner: { fullName: app.owner?.fullName || '', nicLast4: app.owner?.nicLast4 || '' },
    documents: (app.documents || []).map(documentView),
    submittedAt: app.submittedAt || null,
    decision: app.decision?.outcome ? { outcome: app.decision.outcome, notes: app.decision.notes, decidedAt: app.decision.decidedAt } : null,
    problems: EDITABLE.includes(app.status) ? submissionProblems(app, now) : [],
    editable: EDITABLE.includes(app.status),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

function adminView(app) {
  const user = app.userId && app.userId._id ? app.userId : null;
  return {
    ...applicantView(app),
    problems: submissionProblems(app),
    riskFlags: app.riskFlags || [],
    applicant: user ? { _id: String(user._id), name: user.name, email: user.email, phone: user.phone, createdAt: user.createdAt } : { _id: String(app.userId) },
    decision: app.decision?.outcome
      ? { outcome: app.decision.outcome, notes: app.decision.notes, decidedAt: app.decision.decidedAt, decidedBy: app.decision.decidedBy ? String(app.decision.decidedBy) : null }
      : null,
    history: (app.history || []).map((h) => ({ status: h.status, actorRole: h.actorRole, actorId: h.actorId ? String(h.actorId) : null, note: h.note, at: h.at })),
    consentAt: app.consentAt || null,
  };
}

// ───────────────────────────── Applicant operations ─────────────────────────────

async function findOpenApplication(userId) {
  return VendorApplication.findOne({ userId, status: { $in: OPEN } });
}

async function latestApplication(userId) {
  return VendorApplication.findOne({ userId }).sort({ createdAt: -1 });
}

/** GET /api/kyb/application: the caller's open application, or their latest one (to show a decision). */
async function getMyApplication(user) {
  const app = (await findOpenApplication(user._id)) || (await latestApplication(user._id));
  return {
    application: applicantView(app),
    vendorStatus: user.vendorStatus || VENDOR_STATUS.NONE,
    role: user.role,
    canApply: canStartApplication(user),
    reapplyAfter: user.reapplyAfter || null,
    rules: {
      docTypes: KYB.DOC_TYPES,
      docLabels: KYB.DOC_LABELS,
      maxPerType: KYB.MAX_PER_TYPE,
      invoicesMin: KYB.INVOICES_MIN,
      invoicesMax: KYB.INVOICES_MAX,
      invoiceWindowMonths: KYB.INVOICE_WINDOW_MONTHS,
      invoiceMinDistinctMonths: KYB.INVOICE_MIN_DISTINCT_MONTHS,
      utilityBillMaxAgeMonths: KYB.UTILITY_BILL_MAX_AGE_MONTHS,
      maxFileMb: KYB.MAX_FILE_MB,
      maxTotalMb: KYB.MAX_TOTAL_MB,
      mimeTypes: KYB.MIME_TYPES,
    },
  };
}

function canStartApplication(user) {
  if (user.role !== ROLES.BUYER) return false;
  if (user.reapplyAfter && user.reapplyAfter > new Date()) return false;
  return true;
}

function assertBuyerApplicant(user) {
  if (user.role === ROLES.VENDOR) throw ApiError.conflict('Your account is already a vendor account', { code: 'KYB_ALREADY_VENDOR' });
  if (user.role !== ROLES.BUYER) throw ApiError.forbidden('Only buyer accounts can apply to become vendors');
}

async function loadEditable(user) {
  assertBuyerApplicant(user);
  const app = await findOpenApplication(user._id);
  if (!app) throw ApiError.notFound('Start your application by saving your business details first', { code: 'KYB_NO_APPLICATION' });
  if (!EDITABLE.includes(app.status)) {
    throw ApiError.conflict('Your application is under review and can no longer be changed. You can withdraw it instead.', { code: 'KYB_LOCKED' });
  }
  return app;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

/**
 * PUT /api/kyb/application: create or update the caller's draft (business details and owner identity).
 * Only these named fields are read from the body.
 */
async function saveDraft(user, body = {}) {
  assertBuyerApplicant(user);
  let app = await findOpenApplication(user._id);
  if (!app) {
    if (!canStartApplication(user)) {
      throw ApiError.conflict(`You can apply again after ${user.reapplyAfter.toISOString().slice(0, 10)}`, { code: 'KYB_COOLDOWN' });
    }
    app = new VendorApplication({ userId: user._id, status: 'DRAFT', history: [{ status: 'DRAFT', actorId: user._id, actorRole: 'applicant' }] });
  } else if (!EDITABLE.includes(app.status)) {
    throw ApiError.conflict('Your application is under review and can no longer be changed.', { code: 'KYB_LOCKED' });
  }

  const b = body.business || {};
  const errors = [];
  const business = {
    legalName: str(b.legalName, 150),
    tradingName: str(b.tradingName, 150),
    businessRegNo: str(b.businessRegNo, 50)?.toUpperCase(),
    address: {
      line1: str(b.address?.line1, 150),
      line2: str(b.address?.line2, 150),
      city: str(b.address?.city, 80),
      district: str(b.address?.district, 80),
      postalCode: str(b.address?.postalCode, 10),
    },
  };
  for (const [label, value] of [['Legal name', business.legalName], ['Trading name', business.tradingName]]) {
    if (value && containsContactInfo(value)) errors.push(`${label} must not contain phone numbers, e-mails, links or messaging handles`);
  }
  if (business.businessRegNo && !/^[A-Z0-9/-]{3,50}$/.test(business.businessRegNo)) errors.push('BR number may contain only letters, digits, "/" and "-"');
  if (Array.isArray(b.capabilities)) {
    const caps = [...new Set(b.capabilities.map(String))];
    const invalid = caps.filter((c) => !PRINT_TYPES.includes(c));
    if (invalid.length) errors.push(`Unknown printing methods: ${invalid.join(', ')}`);
    business.capabilities = caps.filter((c) => PRINT_TYPES.includes(c));
  }
  if (b.maxCapacity !== undefined && b.maxCapacity !== '') {
    const cap = Number(b.maxCapacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 1000000) errors.push('Maximum capacity must be a whole number of pieces');
    else business.maxCapacity = cap;
  }
  if (b.licenseExpiryDate) {
    const date = new Date(b.licenseExpiryDate);
    if (Number.isNaN(date.getTime())) errors.push('Licence expiry date is not a valid date');
    else business.licenseExpiryDate = date;
  }

  const o = body.owner || {};
  const fullName = str(o.fullName, 120);
  if (fullName && containsContactInfo(fullName)) errors.push("Owner's name must not contain contact details");
  let nic = null;
  if (o.nic !== undefined && o.nic !== '') {
    if (!isValidNic(o.nic)) errors.push('NIC must be 9 digits followed by V or X, or 12 digits');
    else nic = o.nic;
  }
  if (errors.length) throw ApiError.badRequest('Please correct the application details', { code: 'KYB_VALIDATION', details: errors });

  // Merge: fields not sent keep their previous value.
  const merged = { ...(app.business?.toObject?.() || app.business || {}) };
  Object.entries(business).forEach(([k, v]) => {
    if (k === 'address') merged.address = { ...(merged.address || {}), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
    else if (v !== undefined) merged[k] = v;
  });
  app.business = merged;
  if (fullName !== undefined) app.set('owner.fullName', fullName);
  if (nic) {
    app.set('owner.nicHash', nicFingerprint(nic));
    app.set('owner.nicLast4', nicLast4(nic));
  }
  await app.save();

  await User.updateOne({ _id: user._id }, { $set: { vendorStatus: USER_STATUS[app.status], currentApplicationId: app._id } });
  return applicantView(app);
}

/** POST /api/kyb/application/documents (multipart: file, type, issuedOn?). */
async function uploadDocument(user, { type, issuedOn, file }) {
  const store = storage.requireStorage();
  const app = await loadEditable(user);
  if (!KYB.DOC_TYPES.includes(type)) throw ApiError.badRequest(`type must be one of ${KYB.DOC_TYPES.join(', ')}`);
  if (!file?.buffer) throw ApiError.badRequest('Attach the document in the "file" field');

  let issued;
  if (type === 'PAST_INVOICE' || type === 'UTILITY_BILL') {
    issued = new Date(issuedOn);
    if (!issuedOn || Number.isNaN(issued.getTime())) throw ApiError.badRequest('Enter the date shown on the document');
    if (issued > new Date(Date.now() + DAY)) throw ApiError.badRequest('The document date cannot be in the future');
  }

  const sameType = app.documents.filter((d) => d.type === type);
  const replacing = KYB.MAX_PER_TYPE[type] === 1 ? sameType[0] : null;
  if (!replacing && sameType.length >= KYB.MAX_PER_TYPE[type]) {
    throw ApiError.badRequest(`You can upload at most ${KYB.MAX_PER_TYPE[type]} files of this type`, { code: 'KYB_TOO_MANY_FILES' });
  }

  const inspected = await inspectDocument(file.buffer);
  const totalBytes = app.documents.filter((d) => d !== replacing).reduce((s, d) => s + d.sizeBytes, 0) + inspected.sizeBytes;
  if (totalBytes > KYB.MAX_TOTAL_MB * 1024 * 1024) throw ApiError.badRequest(`All documents together must stay under ${KYB.MAX_TOTAL_MB} MB`);
  if (app.documents.some((d) => d.sha256 === inspected.sha256 && d !== replacing)) {
    throw ApiError.badRequest('This exact file is already part of your application', { code: 'KYB_DUPLICATE_FILE' });
  }

  const key = storage.objectKey({ userId: user._id, applicationId: app._id, type, ext: inspected.ext });
  await store.put(key, inspected.buffer, inspected.mimeType);

  let oldKey = null;
  if (replacing) {
    oldKey = replacing.storageKey;
    app.documents.pull(replacing._id);
  }
  app.documents.push({
    type,
    storageKey: key,
    originalName: storage.safeFilename(file.originalname, inspected.ext),
    mimeType: inspected.mimeType,
    sizeBytes: inspected.sizeBytes,
    sha256: inspected.sha256,
    issuedOn: issued,
  });
  try {
    await app.save();
  } catch (err) {
    await store.remove(key).catch(() => {}); // don't leave an orphaned object behind
    throw err;
  }
  if (oldKey) await store.remove(oldKey).catch(() => {});
  return applicantView(app);
}

/** DELETE /api/kyb/application/documents/:docId (own draft only). */
async function removeDocument(user, docId) {
  assertObjectId(docId, 'document id');
  const store = storage.requireStorage();
  const app = await loadEditable(user);
  const doc = app.documents.id(docId);
  if (!doc) throw ApiError.notFound('Document not found');
  app.documents.pull(docId);
  await app.save();
  await store.remove(doc.storageKey).catch(() => {});
  return applicantView(app);
}

/** Flags for the reviewer; they never block submission on their own. */
async function computeRiskFlags(app) {
  const flags = [];
  const withHash = await VendorApplication.findById(app._id).select('+owner.nicHash');
  const nicHash = withHash?.owner?.nicHash;
  if (nicHash) {
    const others = await VendorApplication.countDocuments({
      _id: { $ne: app._id },
      userId: { $ne: app.userId },
      'owner.nicHash': nicHash,
      status: { $in: ['PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED'] },
    });
    if (others) flags.push(`NIC_ON_${others}_OTHER_APPLICATION(S)`);
  }
  if (app.business?.businessRegNo) {
    const brVendor = await User.exists({ _id: { $ne: app.userId }, role: ROLES.VENDOR, businessRegNo: app.business.businessRegNo });
    const brApp = await VendorApplication.exists({
      _id: { $ne: app._id },
      userId: { $ne: app.userId },
      'business.businessRegNo': app.business.businessRegNo,
      status: { $in: ['PENDING_APPROVAL', 'APPROVED'] },
    });
    if (brVendor || brApp) flags.push('BR_NUMBER_ALREADY_REGISTERED');
  }
  const user = await User.findById(app.userId).select('phone');
  if (user?.phone) {
    const tail = String(user.phone).replace(/\D/g, '').slice(-9);
    const samePhoneVendors = (await User.find({ role: ROLES.VENDOR, _id: { $ne: app.userId } }).select('phone').lean()).filter(
      (v) => String(v.phone || '').replace(/\D/g, '').slice(-9) === tail
    ).length;
    if (tail.length === 9 && samePhoneVendors) flags.push('PHONE_SHARED_WITH_EXISTING_VENDOR');
  }
  return flags;
}

/** POST /api/kyb/application/submit { consent: true } */
async function submit(user, { consent } = {}) {
  storage.requireStorage();
  const app = await loadEditable(user);
  if (consent !== true) throw ApiError.badRequest('Please confirm that the documents are genuine and agree to the KYB privacy notice', { code: 'KYB_CONSENT_REQUIRED' });
  const problems = submissionProblems(app);
  if (problems.length) throw ApiError.badRequest('Your application is not complete yet', { code: 'KYB_INCOMPLETE', details: problems });

  const brTaken = await User.exists({ _id: { $ne: user._id }, role: ROLES.VENDOR, businessRegNo: app.business.businessRegNo });
  if (brTaken) {
    throw ApiError.conflict('A vendor account with this BR number already exists. Contact support if this is your business.', { code: 'KYB_BR_TAKEN' });
  }

  const resubmission = app.status === 'CHANGES_REQUESTED';
  transition(app, 'PENDING_APPROVAL', { actor: 'applicant', actorId: user._id, note: resubmission ? 'Resubmitted with changes' : 'Submitted' });
  app.submissionCount += 1;
  app.submittedAt = new Date();
  app.consentAt = new Date();
  app.riskFlags = await computeRiskFlags(app);
  // Reset reviews of rejected documents that were replaced (new uploads already start PENDING).
  await app.save();
  await User.updateOne({ _id: user._id }, { $set: { vendorStatus: VENDOR_STATUS.PENDING_APPROVAL, currentApplicationId: app._id } });

  realtime.emitToRole(ROLES.ADMIN, 'kyb:submitted', {
    applicationId: String(app._id),
    businessName: app.business.legalName,
    resubmission,
    riskFlags: app.riskFlags,
  });
  return applicantView(app);
}

/** POST /api/kyb/application/withdraw */
async function withdraw(user) {
  assertBuyerApplicant(user);
  const app = await findOpenApplication(user._id);
  if (!app) throw ApiError.notFound('You have no open application');
  transition(app, 'WITHDRAWN', { actor: 'applicant', actorId: user._id, note: 'Withdrawn by applicant' });
  app.purgeAfter = new Date(); // nothing to keep: documents are deleted by the next purge run
  await app.save();
  await User.updateOne({ _id: user._id }, { $set: { vendorStatus: VENDOR_STATUS.NONE }, $unset: { currentApplicationId: 1 } });
  purgeExpiredDocuments().catch(() => {});
  return applicantView(app);
}

// ───────────────────────────── Admin operations ─────────────────────────────

async function adminList({ status = 'PENDING_APPROVAL', page = 1, limit = 20 } = {}) {
  const filter = {};
  const statuses = String(status).split(',').filter((s) => VendorApplication.APPLICATION_STATUS.includes(s));
  if (statuses.length) filter.status = { $in: statuses };
  const skip = (page - 1) * limit;
  const [items, total, pending] = await Promise.all([
    VendorApplication.find(filter).sort({ submittedAt: 1, createdAt: 1 }).skip(skip).limit(limit).populate('userId', 'name email phone createdAt'),
    VendorApplication.countDocuments(filter),
    VendorApplication.countDocuments({ status: 'PENDING_APPROVAL' }),
  ]);
  return {
    items: items.map((a) => ({
      _id: String(a._id),
      status: a.status,
      businessName: a.business?.legalName || '(no name yet)',
      businessRegNo: a.business?.businessRegNo || '',
      applicant: a.userId ? { name: a.userId.name, email: a.userId.email } : null,
      documents: a.documents.length,
      riskFlags: a.riskFlags,
      submissionCount: a.submissionCount,
      submittedAt: a.submittedAt,
      updatedAt: a.updatedAt,
    })),
    total,
    pending,
    page,
    limit,
  };
}

async function loadForAdmin(applicationId) {
  assertObjectId(applicationId, 'application id');
  const app = await VendorApplication.findById(applicationId).populate('userId', 'name email phone createdAt role vendorStatus');
  if (!app) throw ApiError.notFound('Application not found');
  return app;
}

async function adminGet(applicationId) {
  return adminView(await loadForAdmin(applicationId));
}

/** Finds a document that belongs to THIS application (never by document id alone). */
async function documentForAdmin(admin, applicationId, docId, action, req) {
  assertObjectId(applicationId, 'application id');
  assertObjectId(docId, 'document id');
  const app = await VendorApplication.findById(applicationId);
  const doc = app?.documents.id(docId);
  if (!doc) throw ApiError.notFound('Document not found');
  if (app.documentsPurgedAt) throw ApiError.notFound('These documents were deleted under the retention policy');
  await KybAccessLog.create({
    adminId: admin._id,
    applicationId: app._id,
    documentId: doc._id,
    documentType: doc.type,
    action,
    ip: req?.ip,
    userAgent: req?.get?.('user-agent')?.slice(0, 200),
  });
  return { app, doc };
}

/** Streams the file through the API (no storage URL ever reaches the browser). */
async function streamDocument(admin, applicationId, docId, req, res) {
  const store = storage.requireStorage();
  const { doc } = await documentForAdmin(admin, applicationId, docId, 'VIEW', req);
  const body = await store.stream(doc.storageKey);
  res.set({
    'Content-Type': doc.mimeType,
    'Content-Disposition': `inline; filename="${doc.originalName || `document.${doc.mimeType.split('/')[1]}`}"`,
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  await new Promise((resolve, reject) => {
    body.on('error', reject);
    res.on('finish', resolve);
    res.on('close', resolve);
    body.pipe(res);
  });
}

/** 60-second presigned link (Cloudflare R2 only), for opening a document in a new tab. */
async function documentLink(admin, applicationId, docId, req) {
  const store = storage.requireStorage();
  if (store.name !== 'r2') throw ApiError.badRequest('Temporary links need Cloudflare R2 storage; use the inline viewer instead', { code: 'KYB_LINK_UNAVAILABLE' });
  const { doc } = await documentForAdmin(admin, applicationId, docId, 'LINK', req);
  const url = await store.signedUrl(doc.storageKey, { contentType: doc.mimeType, filename: doc.originalName || 'document' });
  return { url, expiresInSeconds: storage.SIGNED_URL_SECONDS };
}

/** POST .../documents/:docId/review { status: ACCEPTED|REJECTED, reason? } */
async function reviewDocument(admin, applicationId, docId, { status, reason } = {}) {
  if (!['ACCEPTED', 'REJECTED'].includes(status)) throw ApiError.badRequest('status must be ACCEPTED or REJECTED');
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
  if (status === 'REJECTED' && cleanReason.length < 5) throw ApiError.badRequest('Tell the applicant why this document was not accepted');
  const app = await loadForAdmin(applicationId);
  if (app.status !== 'PENDING_APPROVAL') throw ApiError.conflict('Only applications awaiting review can be reviewed', { code: 'KYB_NOT_PENDING' });
  assertObjectId(docId, 'document id');
  const doc = app.documents.id(docId);
  if (!doc) throw ApiError.notFound('Document not found');
  doc.review = { status, reason: status === 'REJECTED' ? cleanReason : '', reviewedBy: admin._id, reviewedAt: new Date() };
  await app.save();
  return adminView(app);
}

/**
 * POST .../decision { outcome: APPROVED|CHANGES_REQUESTED|REJECTED, notes? }
 * The ONLY place where a buyer becomes a vendor.
 */
async function decide(admin, applicationId, { outcome, notes } = {}) {
  if (!['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].includes(outcome)) throw ApiError.badRequest('outcome must be APPROVED, CHANGES_REQUESTED or REJECTED');
  const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 1000) : '';
  const app = await loadForAdmin(applicationId);
  const applicant = await User.findById(app.userId._id || app.userId);
  if (!applicant) throw ApiError.notFound('The applicant account no longer exists');

  if (outcome === 'APPROVED') {
    const problems = submissionProblems(app);
    if (problems.length) throw ApiError.conflict('The application no longer meets the submission rules', { code: 'KYB_INCOMPLETE', details: problems });
    const unaccepted = app.documents.filter((d) => d.review?.status !== 'ACCEPTED');
    if (unaccepted.length) {
      throw ApiError.conflict('Accept every document before approving', { code: 'KYB_DOCUMENTS_NOT_ACCEPTED', details: unaccepted.map((d) => KYB.DOC_LABELS[d.type]) });
    }
    if (applicant.role !== ROLES.BUYER || !applicant.isActive) throw ApiError.conflict('Only an active buyer account can be upgraded', { code: 'KYB_APPLICANT_INVALID' });
    const brTaken = await User.exists({ _id: { $ne: applicant._id }, role: ROLES.VENDOR, businessRegNo: app.business.businessRegNo });
    if (brTaken) throw ApiError.conflict('Another vendor already uses this BR number', { code: 'KYB_BR_TAKEN' });
  }
  if (outcome === 'CHANGES_REQUESTED' && !app.documents.some((d) => d.review?.status === 'REJECTED') && cleanNotes.length < 5) {
    throw ApiError.badRequest('Reject at least one document, or explain in the notes what must change');
  }
  if (outcome === 'REJECTED' && cleanNotes.length < 5) throw ApiError.badRequest('Give the reason for rejecting the application');

  const now = new Date();
  transition(app, outcome, { actor: 'admin', actorId: admin._id, note: cleanNotes });
  app.decision = { outcome, notes: cleanNotes, decidedBy: admin._id, decidedAt: now };
  if (outcome === 'REJECTED') app.purgeAfter = new Date(now.getTime() + KYB.REJECTED_RETENTION_DAYS * DAY);
  await app.save(); // version-checked: a concurrent decision fails here, before the user is changed

  if (outcome === 'APPROVED') {
    const b = app.business;
    Object.assign(applicant, {
      role: ROLES.VENDOR,
      vendorStatus: VENDOR_STATUS.APPROVED,
      companyName: b.legalName,
      businessRegNo: b.businessRegNo,
      capabilities: b.capabilities,
      maxCapacity: b.maxCapacity,
      licenseExpiryDate: b.licenseExpiryDate,
      isVerified: true,
      verifiedAt: now,
      verifiedBy: admin._id,
      verificationNotes: 'Approved through KYB review',
      kybApprovedAt: now,
      kybApprovedBy: admin._id,
    });
    applicant.set('reapplyAfter', undefined);
    await applicant.save();
  } else if (outcome === 'CHANGES_REQUESTED') {
    await User.updateOne({ _id: applicant._id }, { $set: { vendorStatus: VENDOR_STATUS.CHANGES_REQUESTED } });
  } else {
    await User.updateOne(
      { _id: applicant._id },
      { $set: { vendorStatus: VENDOR_STATUS.REJECTED, reapplyAfter: new Date(now.getTime() + KYB.REAPPLY_COOLDOWN_DAYS * DAY) } }
    );
  }

  const messages = {
    APPROVED: 'Your vendor application was approved. Welcome to CustomT as a vendor! Please sign in again if the menu has not changed.',
    CHANGES_REQUESTED: 'Your vendor application needs some changes. Open "Sell on CustomT" to see what to fix.',
    REJECTED: 'Your vendor application was not approved. Open "Sell on CustomT" for the reason.',
  };
  realtime.emitToUser(applicant._id, 'kyb:decision', { applicationId: String(app._id), outcome, notes: cleanNotes, message: messages[outcome] });
  if (outcome === 'APPROVED') {
    // Sockets joined the buyer role room at connect time. After the decision event has been delivered,
    // close them; the client reconnects and joins the vendor rooms.
    const io = realtime.getIO();
    if (io) setTimeout(() => io.in(realtime.rooms.user(String(applicant._id))).disconnectSockets(true), 1500).unref();
  }
  return adminView(app);
}

// ───────────────────────────── Retention ─────────────────────────────

/** Deletes the documents of rejected / withdrawn applications after their retention period. */
async function purgeExpiredDocuments() {
  let store;
  try {
    store = storage.requireStorage();
  } catch {
    return 0;
  }
  const due = await VendorApplication.find({
    status: { $in: ['REJECTED', 'WITHDRAWN'] },
    purgeAfter: { $lte: new Date() },
    documentsPurgedAt: null,
  })
    
    .limit(50);
  for (const app of due) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(app.documents.map((d) => store.remove(d.storageKey).catch(() => {})));
    app.documents = [];
    app.documentsPurgedAt = new Date();
    app.history.push({ status: app.status, actorRole: 'system', note: 'Documents deleted under the retention policy' });
    // eslint-disable-next-line no-await-in-loop
    await app.save();
  }
  return due.length;
}

let purgeHandle = null;
function startRetentionScheduler() {
  if (purgeHandle) return;
  const tick = () =>
    purgeExpiredDocuments().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[kyb-retention] failed:', err.message);
    });
  purgeHandle = setInterval(tick, 60 * 60 * 1000);
  if (purgeHandle.unref) purgeHandle.unref();
}
function stopRetentionScheduler() {
  if (purgeHandle) clearInterval(purgeHandle);
  purgeHandle = null;
}

module.exports = {
  TRANSITIONS,
  transition,
  submissionProblems,
  getMyApplication,
  saveDraft,
  uploadDocument,
  removeDocument,
  submit,
  withdraw,
  adminList,
  adminGet,
  streamDocument,
  documentLink,
  reviewDocument,
  decide,
  purgeExpiredDocuments,
  startRetentionScheduler,
  stopRetentionScheduler,
};
