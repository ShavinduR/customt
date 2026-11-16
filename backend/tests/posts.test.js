const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-unit-test-secret-1234';

const { Post } = require('../models');
const { encodeCursor, decodeCursor } = require('../services/feedService');

const IMG = '/uploads/logos/0123456789abcdef01234567-1731480000000-a1b2c3d4.jpg';
const vendorId = new mongoose.Types.ObjectId();
const premium = (over = {}) => ({
  vendorId,
  postType: 'PREMIUM_CATALOG',
  title: 'Heavyweight crew neck',
  postDescription: '220 GSM combed cotton, pre-shrunk.',
  images: [IMG],
  garmentType: 'Crew Neck',
  sizeChart: [
    { size: 'M', chestCm: 104, lengthCm: 72, sleeveCm: 21 },
    { size: 'L', chestCm: 110, lengthCm: 74 },
  ],
  fabricSpecs: { fabric: '100% Cotton', gsm: 220, composition: '100% combed ring-spun cotton' },
  ...over,
});

/** Runs schema validation (including the pre-validate hook) without a database. */
async function errorsOf(data) {
  const doc = new Post(data);
  try {
    await doc.validate();
    return { doc, errors: {} };
  } catch (err) {
    return { doc, errors: Object.fromEntries(Object.entries(err.errors || {}).map(([k, v]) => [k, v.message])) };
  }
}

test('a complete Premium Catalog post is valid', async () => {
  const { errors } = await errorsOf(premium());
  assert.deepEqual(errors, {});
});

test('Premium Catalog posts require a size chart and fabric specs', async () => {
  const { errors } = await errorsOf(premium({ sizeChart: undefined, fabricSpecs: undefined }));
  assert.match(errors.sizeChart, /size chart/);
  assert.match(errors.fabricSpecs, /fabric specs/);

  const empty = await errorsOf(premium({ sizeChart: [] }));
  assert.match(empty.errors.sizeChart, /size chart/, 'an empty size chart is rejected');

  const dup = await errorsOf(premium({ sizeChart: [{ size: 'M', chestCm: 104, lengthCm: 72 }, { size: 'M', chestCm: 106, lengthCm: 73 }] }));
  assert.match(dup.errors.sizeChart, /only once/);

  const bad = await errorsOf(premium({ sizeChart: [{ size: 'XXXL', chestCm: 500, lengthCm: 72 }], fabricSpecs: { fabric: 'Silk', gsm: 999 } }));
  assert.ok(bad.errors['sizeChart.0.size'] && bad.errors['sizeChart.0.chestCm'], JSON.stringify(bad.errors));
  assert.ok(bad.errors['fabricSpecs.fabric'] && bad.errors['fabricSpecs.gsm'], JSON.stringify(bad.errors));
});

test('Inspiration posts need no size chart; Clearance posts need stock details', async () => {
  const inspiration = await errorsOf({ vendorId, postType: 'INSPIRATION', title: 'Gold foil on black', images: [IMG] });
  assert.deepEqual(inspiration.errors, {});

  const clearance = await errorsOf({ vendorId, postType: 'CLEARANCE', title: 'Plain polos', images: [IMG] });
  assert.match(clearance.errors.clearance, /available quantity/);
  assert.match(clearance.errors.garmentType, /garment type/);

  const ok = await errorsOf({ vendorId, postType: 'CLEARANCE', title: 'Plain polos', images: [IMG], garmentType: 'Polo', clearance: { availableQuantity: 120, unitPrice: 650 } });
  assert.deepEqual(ok.errors, {});

  const misplaced = await errorsOf({ vendorId, postType: 'INSPIRATION', title: 'Idea', images: [IMG], clearance: { availableQuantity: 5, unitPrice: 100 } });
  assert.match(misplaced.errors.clearance, /only allowed on Clearance/);
});

test('contact details are masked in the description, title and composition before saving', async () => {
  const { doc, errors } = await errorsOf(
    premium({
      title: 'Bulk deals - WhatsApp 0771234567',
      postDescription: 'Order direct: call me on 077 123 4567 or mail sales@printco.lk, pay by bank transfer for 10% off',
      fabricSpecs: { fabric: '100% Cotton', gsm: 220, composition: 'see www.printco.lk' },
    })
  );
  assert.deepEqual(errors, {});
  for (const text of [doc.title, doc.postDescription, doc.fabricSpecs.composition]) {
    assert.ok(!/\d{3}\s?\d{3}\s?\d{4}|@|whatsapp|printco|bank transfer/i.test(text), text);
    assert.ok(text.includes('[CONTACT BLOCKED]'), text);
  }
  assert.deepEqual([...doc.contactFlags].sort(), ['app', 'contact-request', 'email', 'link', 'payment', 'phone']);
});

test('photos must be 1-6 CustomT uploads', async () => {
  assert.match((await errorsOf(premium({ images: [] }))).errors.images, /1 to 6 photos/);
  assert.match((await errorsOf(premium({ images: Array(7).fill(IMG) }))).errors.images, /1 to 6 photos/);
  assert.match((await errorsOf(premium({ images: ['https://wa.me/94771234567'] }))).errors.images, /uploaded to CustomT/);
});

test('post content cannot be changed with a query update (that would skip the filter)', async () => {
  const query = Post.updateOne({ _id: new mongoose.Types.ObjectId() }, { $set: { postDescription: 'call 0771234567' } });
  await assert.rejects(query.exec(), (err) => err.code === 'POST_CONTENT_UPDATE');
});

test('feed cursors round-trip and reject tampering', () => {
  const post = { createdAt: new Date('2026-11-16T10:00:00Z'), _id: new mongoose.Types.ObjectId() };
  const decoded = decodeCursor(encodeCursor(post));
  assert.equal(decoded.createdAt.getTime(), post.createdAt.getTime());
  assert.equal(String(decoded._id), String(post._id));
  assert.equal(decodeCursor(''), null);
  assert.throws(() => decodeCursor('not-a-cursor'), (err) => err.code === 'INVALID_CURSOR');
  assert.throws(() => decodeCursor(Buffer.from('{"t":1,"id":{"$ne":null}}').toString('base64url')), (err) => err.code === 'INVALID_CURSOR');
});
