const test = require('node:test');
const assert = require('node:assert/strict');
const { filterContactInfo, BLOCK } = require('../utils/contactFilter');

const blocked = (text) => filterContactInfo(text);

test('Sri Lankan and international phone numbers are blocked in every common format', () => {
  for (const sample of ['0771234567', '077 123 4567', '077-123-4567', '+94 77 123 4567', '94771234567', '(077) 123-4567', '0 7 7 1 2 3 4 5 6 7', '771234567', '011 234 5678']) {
    const r = blocked(`Call ${sample} tomorrow`);
    assert.ok(!/\d{3}/.test(r.text.replace(/tomorrow/, '')), `${sample} -> ${r.text}`);
    assert.ok(r.flags.includes('phone'), `${sample} flagged as phone`);
  }
});

test('the example from the brief: 0771234567 becomes [CONTACT BLOCKED]', () => {
  assert.equal(blocked('0771234567').text, BLOCK);
});

test('numbers spelled out in words are blocked', () => {
  const r = blocked('my digits are zero seven seven one two three four five six seven');
  assert.ok(r.text.includes(BLOCK));
  assert.ok(r.flags.includes('phone'));
});

test('e-mail addresses are blocked, including "at ... dot" disguises', () => {
  for (const sample of ['kasun.silva@gmail.com', 'kasun at gmail dot com', 'kasun [at] yahoo [dot] com', 'kasun(at)printworks.lk', 'send to my gmail']) {
    const r = blocked(sample);
    assert.ok(r.text.includes(BLOCK), `${sample} -> ${r.text}`);
    assert.ok(!/gmail|yahoo|printworks/i.test(r.text), `${sample} -> ${r.text}`);
  }
});

test('messaging apps are blocked, including letter-by-letter spellings', () => {
  for (const sample of ['WhatsApp', 'whats app', 'W.h.a.t.s.A.p.p', 'w h a t s a p p', 'watsapp', 'Viber', 'TELEGRAM', 'on signal', 'fb messenger']) {
    const r = blocked(`message me on ${sample} please`);
    assert.ok(r.text.includes(BLOCK), `${sample} -> ${r.text}`);
  }
});

test('links and shortened links are blocked', () => {
  for (const sample of ['https://example.com/pay', 'www.printworks.lk', 'wa.me/94771234567', 'bit.ly/abc123', 'printworks.lk']) {
    assert.ok(blocked(`see ${sample}`).flags.includes('link'), sample);
  }
});

test('"call me" requests and off-escrow payment attempts are blocked', () => {
  assert.ok(blocked('Just call me when ready').flags.includes('contact-request'));
  assert.ok(blocked('Here is my number').flags.includes('contact-request'));
  assert.ok(blocked('Let us talk off the platform').flags.includes('contact-request'));
  assert.ok(blocked('You can pay me directly by bank transfer').flags.includes('payment'));
});

test('ordinary order conversation passes through unchanged', () => {
  const samples = [
    'The total is LKR 1,500,000 for 1,200 pieces.',
    'Sizes: S 20 M 40 L 40 XL 15 XXL 5',
    'Order ORD-261113-QWERTY ships on 2026-11-20.',
    'Can you match Pantone 2758C on the navy?',
    'We will deliver 120 polo shirts in 7 days.',
    'The price signal looks fine, thanks!',
    'Please message me here when the samples are ready.',
    'Unit price LKR 1250.00, lead time 10 days, 30% advance.',
  ];
  for (const sample of samples) {
    const r = blocked(sample);
    assert.equal(r.text, sample, `changed: ${sample} -> ${r.text}`);
    assert.equal(r.flagged, false);
  }
});

test('several blocked items in one message are all masked and reported', () => {
  const r = blocked('WhatsApp me on 0771234567 or email kasun@gmail.com');
  assert.ok(!/0771234567|kasun|gmail/i.test(r.text), r.text);
  assert.deepEqual([...r.flags].sort(), ['app', 'email', 'phone']);
  assert.equal(r.text, `${BLOCK} me on ${BLOCK} or email ${BLOCK}`);
});
