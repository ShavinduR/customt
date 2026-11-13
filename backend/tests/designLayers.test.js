const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDesignSpecs, calculateExpectedDeliveryDays } = require('../utils/rfqCalculator');

const base = {
  garmentType: 'Crew Neck',
  fabric: '100% Cotton',
  gsm: 180,
  color: '#1e3a8a',
  printType: 'Screen Printing',
  sizeBreakdown: { S: 10, M: 20, L: 20, XL: 10, XXL: 5 },
};
const text = (over = {}) => ({ id: 't1', side: 'front', text: 'ACME 2026', font: 'Montserrat', size: 28, color: '#ffffff', x: 50, y: 30, ...over });
const image = (over = {}) => ({ id: 'i1', side: 'front', url: '/uploads/logos/a.png', x: 50, y: 20, scale: 0.4, ...over });

test('layered designs: multiple images on front and back, text with font/size, sleeves', () => {
  const specs = buildDesignSpecs({
    ...base,
    textLayers: [text(), text({ id: 't2', side: 'back', text: 'STAFF', font: 'Pacifico', size: 40 }), text({ id: 't3', side: 'leftSleeve', text: 'NO 7', size: 10 })],
    imageLayers: [image(), image({ id: 'i2', y: 60 }), image({ id: 'i3', side: 'back', scale: 0.8 })],
  });
  assert.deepEqual(specs.printedSides, ['front', 'back', 'leftSleeve']);
  assert.equal(specs.printPlacement, 'FRONT_AND_BACK');
  assert.equal(specs.imageLayers.length, 3);
  assert.equal(specs.textLayers[1].font, 'Pacifico');
  assert.equal(specs.textLayers[0].color, '#FFFFFF', 'colours are normalised');
  assert.equal(specs.customText, 'ACME 2026');
  assert.equal(specs.backText, 'STAFF');
  // Screen 7 + crew 0 + volume 0 + 2 extra printed sides
  assert.equal(calculateExpectedDeliveryDays(specs), 9);
});

test('a back-only design is BACK; a sleeve-only design is FRONT (sleeve prints sit on the front face)', () => {
  assert.equal(buildDesignSpecs({ ...base, textLayers: [text({ side: 'back' })], imageLayers: [] }).printPlacement, 'BACK');
  assert.equal(buildDesignSpecs({ ...base, textLayers: [text({ side: 'rightSleeve' })], imageLayers: [] }).printPlacement, 'FRONT');
});

test('positions and sizes are clamped into range', () => {
  const specs = buildDesignSpecs({ ...base, textLayers: [text({ x: 140, y: -5, size: 500 })], imageLayers: [image({ scale: 9 })] });
  assert.equal(specs.textLayers[0].x, 100);
  assert.equal(specs.textLayers[0].y, 0);
  assert.equal(specs.textLayers[0].size, 96);
  assert.equal(specs.imageLayers[0].scale, 1);
});

test('invalid layers are rejected with precise messages', () => {
  const attempt = (over) => {
    try {
      buildDesignSpecs({ ...base, ...over });
      return [];
    } catch (err) {
      return err.details || [err.message];
    }
  };
  assert.ok(attempt({ textLayers: [text({ font: 'Comic Sans' })], imageLayers: [] }).some((m) => /font must be one of/.test(m)));
  assert.ok(attempt({ textLayers: [text({ color: 'red' })], imageLayers: [] }).some((m) => /hex colour/.test(m)));
  assert.ok(attempt({ textLayers: [text({ side: 'collar' })], imageLayers: [] }).some((m) => /side must be one of/.test(m)));
  assert.ok(attempt({ textLayers: [text({ text: '   ' })], imageLayers: [] }).some((m) => /is empty/.test(m)));
  assert.ok(attempt({ textLayers: [], imageLayers: [image({ url: 'javascript:alert(1)' })] }).some((m) => /uploaded image/.test(m)));
  assert.ok(attempt({ textLayers: [], imageLayers: [] }).some((m) => /Add text or an image/.test(m)));
  const many = Array.from({ length: 9 }, (_, i) => image({ id: `i${i}` }));
  assert.ok(attempt({ textLayers: [], imageLayers: many }).some((m) => /at most 8 images/.test(m)));
});

test('the original single text/logo format is converted into layers', () => {
  const specs = buildDesignSpecs({
    ...base,
    printPlacement: 'FRONT_AND_BACK',
    customText: 'CLUB 2026',
    backText: 'VOLUNTEER',
    logoUrl: '/uploads/logos/club.png',
    textColor: '#ffcc00',
    designPosition: { x: 50, y: 30, scale: 1 },
  });
  assert.deepEqual(specs.printedSides, ['front', 'back']);
  assert.deepEqual(specs.textLayers.map((l) => [l.side, l.text, l.font, l.color]), [
    ['front', 'CLUB 2026', 'Bebas Neue', '#FFCC00'],
    ['back', 'VOLUNTEER', 'Bebas Neue', '#FFCC00'],
  ]);
  assert.equal(specs.imageLayers.length, 1);
  assert.equal(specs.imageLayers[0].side, 'front');
});
