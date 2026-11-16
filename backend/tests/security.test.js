const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-unit-test-secret-1234';

const { filterContactInfo, maskContactInfo, containsContactInfo } = require('../utils/contactFilter');
const { isUploadedFileUrl } = require('../utils/uploadUrl');
const { sealPin, openPin } = require('../utils/pinVault');
const { samePhone } = require('../services/orderService');

test('disguised contact details are still blocked', () => {
  const disguised = [
    '０７７１２３４５６７', // full-width digits
    '077​123​4567', // zero-width spaces between digits
    '0⃣7⃣7⃣1⃣2⃣3⃣4⃣5⃣6⃣7⃣', // keycap digits
    'zero 7 seven 1 two 3 4 5 6 seven', // digits and words mixed
    'ｗｈａｔｓａｐｐ', // full-width app name
  ];
  for (const text of disguised) assert.ok(filterContactInfo(text).flagged, text);
});

test('ordinary order talk is untouched', () => {
  for (const text of ['bids: 150,000, 135,000, 120,000', 'S 20 M 40 L 40 XL 20', 'I need one or two more days', 'Order ORD-261113-QWERTY by 2026-11-20']) {
    assert.equal(maskContactInfo(text), text);
  }
});

test('display names with contact details are detected', () => {
  assert.ok(containsContactInfo('Kasun 0771234567'));
  assert.ok(containsContactInfo('Prints - WhatsApp us'));
  assert.ok(!containsContactInfo('Colombo Print Works (Pvt) Ltd'));
});

test('only files uploaded to CustomT are accepted as design images', () => {
  const file = '/uploads/logos/0123456789abcdef01234567-1731480000000-a1b2c3d4.png';
  assert.ok(isUploadedFileUrl(file));
  assert.ok(isUploadedFileUrl(`https://api.example.lk${file}`), 'any host is fine while PUBLIC_API_URL is unset');
  for (const bad of ['https://evil.example/pixel.png', 'https://wa.me/94771234567', `${file}?track=1`, '/uploads/logos/../../server.js', 'javascript:alert(1)']) {
    assert.ok(!isUploadedFileUrl(bad), bad);
  }
});

test('O2O PINs are encrypted at rest and tamper-evident', () => {
  const sealed = sealPin('042117');
  assert.ok(!sealed.includes('042117'));
  assert.notEqual(sealPin('042117'), sealed, 'a fresh IV every time');
  assert.equal(openPin(sealed), '042117');
  assert.equal(openPin(`${sealed.slice(0, -2)}AA`), null, 'modified ciphertext is rejected');
  assert.equal(openPin('123456'), '123456', 'legacy plain PINs still verify');
});

test('buyer and vendor accounts with the same phone number are linked', () => {
  assert.ok(samePhone('+94 77 123 4567', '0771234567'));
  assert.ok(!samePhone('+94771234567', '+94772223344'));
  assert.ok(!samePhone('', ''));
});
