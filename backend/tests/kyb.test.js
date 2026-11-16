const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const sharp = require('sharp');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-unit-test-secret-1234';

const { isValidNic, canonicalNic, nicFingerprint, nicLast4 } = require('../utils/nic');
const { sniffType, pdfProblem, inspectDocument } = require('../utils/fileInspect');
const { submissionProblems, transition, TRANSITIONS } = require('../services/kybService');
const { VendorApplication } = require('../models');

const PDF = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n${extra}\ntrailer<<>>\n%%EOF\n`, 'latin1');

test('NIC: both formats are accepted, the same person gets the same fingerprint, the full number is never needed again', () => {
  assert.ok(isValidNic('851234567V') && isValidNic('851234567x') && isValidNic('198512304567'));
  assert.ok(!isValidNic('12345') && !isValidNic('85123456AV') && !isValidNic('1985123045678'));
  assert.equal(canonicalNic('851234567V'), '198512304567');
  assert.equal(nicFingerprint('851234567V'), nicFingerprint('1985 1230 4567'), 'old and new format of the same NIC match');
  assert.notEqual(nicFingerprint('851234567V'), nicFingerprint('851234568V'));
  assert.match(nicFingerprint('851234567V'), /^[a-f0-9]{64}$/);
  assert.equal(nicLast4('851234567V'), '4567');
});

test('documents: the real type comes from the bytes, risky PDFs are refused', async () => {
  assert.equal(sniffType(PDF()), 'application/pdf');
  assert.equal(sniffType(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(pdfProblem(PDF()), null);
  assert.match(pdfProblem(PDF('<</S /JavaScript /JS (app.alert(1))>>')), /JavaScript/);
  assert.match(pdfProblem(PDF('<</Type /EmbeddedFile>>')), /embedded/);
  assert.match(pdfProblem(PDF('<</Encrypt 5 0 R>>')), /encrypted/);
  assert.match(pdfProblem(Buffer.from('%PDF-1.4 truncated')), /incomplete/);
  await assert.rejects(inspectDocument(Buffer.from('MZ\x90\x00 not a document at all')), (e) => e.code === 'KYB_FILE_TYPE');
  await assert.rejects(inspectDocument(PDF('/Launch')), (e) => e.code === 'KYB_PDF_REJECTED');
});

test('images are re-encoded: EXIF data (e.g. GPS location) is removed', async () => {
  const withExif = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3366cc' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner', ImageDescription: 'GPS 6.9271,79.8612' } })
    .toBuffer();
  assert.ok((await sharp(withExif).metadata()).exif, 'test image has EXIF');
  const clean = await inspectDocument(withExif);
  assert.equal(clean.mimeType, 'image/jpeg');
  assert.equal((await sharp(clean.buffer).metadata()).exif, undefined, 'EXIF stripped');
  assert.match(clean.sha256, /^[a-f0-9]{64}$/);
});

function completeApplication(now) {
  const day = 24 * 3600 * 1000;
  const doc = (type, daysAgo, mimeType = 'image/png') => ({ type, mimeType, sizeBytes: 1000, sha256: `${type}${daysAgo}`, storageKey: 'k', issuedOn: daysAgo === null ? undefined : new Date(now - daysAgo * day) });
  return new VendorApplication({
    userId: new mongoose.Types.ObjectId(),
    business: {
      legalName: 'Alpha Prints (Pvt) Ltd',
      businessRegNo: 'PV12345',
      address: { line1: '12 Main St', city: 'Colombo', district: 'Colombo' },
      capabilities: ['Screen Printing'],
      maxCapacity: 500,
      licenseExpiryDate: new Date(now + 365 * day),
    },
    owner: { fullName: 'Kasun Silva', nicLast4: '4567' },
    documents: [
      doc('BR_COPY', null, 'application/pdf'),
      doc('NIC_FRONT', null),
      doc('NIC_BACK', null),
      doc('UTILITY_BILL', 20),
      doc('PAST_INVOICE', 10),
      doc('PAST_INVOICE', 45),
      doc('PAST_INVOICE', 90),
    ],
  });
}

test('submission rules: a complete application passes; each missing proof is reported', () => {
  const now = Date.now();
  const app = completeApplication(now);
  assert.deepEqual(submissionProblems(app, new Date(now)), []);

  const noInvoices = completeApplication(now);
  noInvoices.documents = noInvoices.documents.filter((d) => d.type !== 'PAST_INVOICE');
  assert.ok(submissionProblems(noInvoices, new Date(now)).some((p) => /at least 3 past business invoices/.test(p)));

  const oneMonth = completeApplication(now);
  oneMonth.documents.forEach((d) => {
    if (d.type === 'PAST_INVOICE') d.issuedOn = new Date(now - 2 * 86400000);
  });
  assert.ok(submissionProblems(oneMonth, new Date(now)).some((p) => /2 different months/.test(p)), 'invoices from a single month are not enough');

  const oldInvoices = completeApplication(now);
  oldInvoices.documents.forEach((d) => {
    if (d.type === 'PAST_INVOICE') d.issuedOn = new Date(now - 500 * 86400000);
  });
  assert.ok(submissionProblems(oldInvoices, new Date(now)).some((p) => /last 12 months/.test(p)));

  const oldBill = completeApplication(now);
  oldBill.documents.find((d) => d.type === 'UTILITY_BILL').issuedOn = new Date(now - 200 * 86400000);
  assert.ok(submissionProblems(oldBill, new Date(now)).some((p) => /utility bill must be dated/.test(p)));

  const noBack = completeApplication(now);
  noBack.documents = noBack.documents.filter((d) => d.type !== 'NIC_BACK');
  assert.ok(submissionProblems(noBack, new Date(now)).some((p) => /back of the NIC/.test(p)));
  noBack.documents.find((d) => d.type === 'NIC_FRONT').mimeType = 'application/pdf';
  assert.ok(!submissionProblems(noBack, new Date(now)).some((p) => /NIC/.test(p)), 'one PDF with both sides is enough');

  const expired = completeApplication(now);
  expired.business.licenseExpiryDate = new Date(now - 86400000);
  assert.ok(submissionProblems(expired, new Date(now)).some((p) => /licence expiry/.test(p)));
});

test('state machine: only the listed moves exist, each by the right actor', () => {
  const app = completeApplication(Date.now());
  const actorId = new mongoose.Types.ObjectId();
  assert.throws(() => transition(app, 'APPROVED', { actor: 'applicant', actorId }), (e) => e.code === 'KYB_INVALID_TRANSITION', 'a draft cannot be approved');
  transition(app, 'PENDING_APPROVAL', { actor: 'applicant', actorId });
  assert.throws(() => transition(app, 'APPROVED', { actor: 'applicant', actorId }), (e) => e.code === 'KYB_FORBIDDEN_TRANSITION', 'applicants cannot approve themselves');
  transition(app, 'CHANGES_REQUESTED', { actor: 'admin', actorId });
  assert.throws(() => transition(app, 'APPROVED', { actor: 'admin', actorId }), (e) => e.code === 'KYB_INVALID_TRANSITION', 'changes must be resubmitted first');
  transition(app, 'PENDING_APPROVAL', { actor: 'applicant', actorId });
  transition(app, 'APPROVED', { actor: 'admin', actorId });
  assert.equal(TRANSITIONS.APPROVED, undefined, 'APPROVED is final');
  assert.deepEqual(app.history.map((h) => h.status), ['PENDING_APPROVAL', 'CHANGES_REQUESTED', 'PENDING_APPROVAL', 'APPROVED']);
});
