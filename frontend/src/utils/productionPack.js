/**
 * Production pack: everything a printer needs to produce a CustomT order without asking questions.
 *
 *  - Print-quality checks (used live in the design studio): effective DPI of every image at its real printed
 *    size, and artwork that runs outside the printable area.
 *  - Spec sheet (PDF): garment, colours, size breakdown, front/back views, and for every print its real size
 *    and position in centimetres. Shared with bidding printers, so they all quote on the same facts.
 *  - Print files (PNG, real size, 300 DPI, transparent): one per printed side, drawn by the same code that
 *    paints the 3D model, so they match the approved design exactly. Offered to the winning printer once the
 *    buyer has funded escrow, together with the spec sheet, as one ZIP.
 *
 * Everything is generated in the browser from the locked specification (fonts and images are already loaded
 * there), so no artwork has to be re-uploaded and nothing heavy runs on the server.
 */
import { HPS_Y, NECK_SEAM_Y, PRINT_AREAS, SIDE_LABEL, TRIMS, UNITS_PER_CM, VIEW_H, VIEW_W } from './garmentGeometry.js';
import { layersOf, printedSides, textExtent } from './design.js';
import { TEXTURE_HEIGHT, TEXTURE_SCALE, TEXTURE_WIDTH, drawLayer, loadDesignFonts, loadImage, paintDesignTexture } from './designTexture.js';

export const PRINT_DPI = 300;
const CM_PER_INCH = 2.54;
const cm = (units) => units / UNITS_PER_CM;
const round1 = (v) => Math.round(v * 10) / 10;
const fmt = (v) => {
  const r = round1(v);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
const garmentOf = (specs) => (PRINT_AREAS[specs.garmentType] ? specs.garmentType : 'Crew Neck');
const isVector = (url) => /\.svg(?:$|\?)/i.test(url || '');

/** All layers with their kind, in drawing order (images under text, as everywhere else). */
function allLayers(specs) {
  const { textLayers, imageLayers } = layersOf(specs);
  return [...imageLayers.map((l, i) => ({ ...l, kind: 'image', index: i + 1 })), ...textLayers.map((l) => ({ ...l, kind: 'text' }))];
}

/** Printed size of a layer in design units (images keep their proportions inside a square of scale × area width). */
function printedSize(layer, area, img) {
  if (layer.kind === 'text') return textExtent(layer); // measured with the real font (fonts loaded first)
  const box = layer.scale * area.w;
  const ratio = img ? img.naturalWidth / img.naturalHeight || 1 : 1;
  return ratio >= 1 ? { w: box, h: box / ratio } : { w: box * ratio, h: box };
}

/** Effective resolution of an image at its printed size. null for vector (SVG) images. */
export function imageDpi(layer, img, area) {
  if (!img || isVector(layer.url)) return null;
  const { w } = printedSize(layer, area, img);
  return img.naturalWidth / (cm(w) / CM_PER_INCH);
}

/** Quality verdict for a DPI value: good ≥ 200, ok ≥ 150, soft ≥ 100, blurry below. */
export function dpiLevel(dpi) {
  if (dpi === null) return { level: 'good', label: 'Vector, sharp at any size' };
  if (dpi >= 200) return { level: 'good', label: `${Math.round(dpi)} DPI, sharp` };
  if (dpi >= 150) return { level: 'ok', label: `${Math.round(dpi)} DPI, acceptable` };
  if (dpi >= 100) return { level: 'warn', label: `${Math.round(dpi)} DPI, may look soft` };
  return { level: 'bad', label: `${Math.round(dpi)} DPI, will print blurry` };
}

/** True when a layer's rotated box reaches outside its print area. */
function outsideArea(layer, area, img) {
  const { w, h } = printedSize(layer, area, img);
  const rad = ((Number(layer.rotation) || 0) * Math.PI) / 180;
  const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const cx = (layer.x / 100) * area.w;
  const cy = (layer.y / 100) * area.h;
  const tol = 0.5 * UNITS_PER_CM; // half a centimetre of slack
  return cx - bw / 2 < -tol || cx + bw / 2 > area.w + tol || cy - bh / 2 < -tol || cy + bh / 2 > area.h + tol;
}

/**
 * Print checks for the studio. Resolves to [{ layerId, side, level: 'warn' | 'bad', message }]
 * plus a per-layer map of image quality: { [layerId]: { dpi, level, label } }.
 */
export async function checkPrintQuality(specs) {
  const g = garmentOf(specs);
  await loadDesignFonts(specs); // text is measured with the real fonts
  const issues = [];
  const quality = {};
  for (const layer of allLayers(specs)) {
    const area = PRINT_AREAS[g][layer.side];
    let img = null;
    if (layer.kind === 'image') {
      ({ img } = await loadImage(layer.url));
      if (img) {
        const dpi = imageDpi(layer, img, area);
        const verdict = dpiLevel(dpi);
        quality[layer.id] = { dpi, ...verdict };
        if (verdict.level === 'bad' || verdict.level === 'warn') {
          issues.push({
            layerId: layer.id,
            side: layer.side,
            level: verdict.level,
            message: `Image ${layer.index} on the ${SIDE_LABEL[layer.side].toLowerCase()}: ${verdict.label} at ${fmt(cm(printedSize(layer, area, img).w))} cm wide. Use a larger image or make it smaller.`,
          });
        }
      }
    }
    if (outsideArea(layer, area, img)) {
      issues.push({
        layerId: layer.id,
        side: layer.side,
        level: 'warn',
        message: `${layer.kind === 'text' ? `"${layer.text}"` : `Image ${layer.index}`} runs outside the ${SIDE_LABEL[layer.side].toLowerCase()} print area and will be cut off.`,
      });
    }
  }
  return { issues, quality };
}

/** Real-world placement of every layer, for the spec sheet. */
async function describeLayers(specs) {
  const g = garmentOf(specs);
  await loadDesignFonts(specs);
  const rows = [];
  for (const layer of allLayers(specs)) {
    const area = PRINT_AREAS[g][layer.side];
    const img = layer.kind === 'image' ? (await loadImage(layer.url)).img : null;
    const size = printedSize(layer, area, img);
    const body = area.rotate === 0;
    const row = {
      side: layer.side,
      kind: layer.kind,
      label: layer.kind === 'text' ? `"${layer.text}"` : `Image ${layer.index}`,
      detail: layer.kind === 'text' ? `${layer.font}, ${layer.color.toUpperCase()}` : isVector(layer.url) ? 'Vector (SVG)' : img ? `${img.naturalWidth} × ${img.naturalHeight} px` : 'image',
      size: `${fmt(cm(size.w))} × ${fmt(cm(size.h))} cm`,
      rotation: `${Number(layer.rotation) || 0}°`,
      quality: `${layer.kind === 'image' ? dpiLevel(imageDpi(layer, img, area)).label : 'Vector text'}${outsideArea(layer, area, img) ? ' · RUNS OUTSIDE THE PRINT AREA (cut off)' : ''}`,
    };
    if (body) {
      const x = area.cx - area.w / 2 + (layer.x / 100) * area.w - VIEW_W / 2;
      const y = area.cy - area.h / 2 + (layer.y / 100) * area.h - HPS_Y[g];
      const side = layer.side === 'back' ? (x > 0 ? 'right' : 'left') : x > 0 ? "wearer's left" : "wearer's right";
      row.position = `${Math.abs(x) < UNITS_PER_CM * 0.25 ? 'centred' : `${fmt(Math.abs(cm(x)))} cm to the ${side}`}, ${fmt(cm(y))} cm below shoulder (HPS)`;
    } else {
      const dx = (layer.x - 50) / 100 * area.w;
      const dy = (layer.y - 50) / 100 * area.h;
      row.position = Math.hypot(dx, dy) < UNITS_PER_CM * 0.25 ? 'centre of the sleeve print area' : `${fmt(cm(dx))} cm along, ${fmt(cm(dy))} cm across from the sleeve area centre`;
    }
    rows.push(row);
  }
  return rows;
}

/** Print-area geometry of each printed side, in centimetres. */
function areaInfo(specs, side) {
  const g = garmentOf(specs);
  const area = PRINT_AREAS[g][side];
  if (side === 'insideLabel') {
    const below = fmt(cm(area.cy - area.h / 2 - NECK_SEAM_Y[g]));
    return { w: cm(area.w), h: cm(area.h), top: null, where: `printed INSIDE the back, top edge ${below} cm below the neck seam` };
  }
  return {
    w: cm(area.w),
    h: cm(area.h),
    top: area.rotate === 0 ? cm(area.cy - area.h / 2 - HPS_Y[g]) : null,
  };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Adds the PNG "pHYs" chunk (physical pixel size) so print software opens the file at the right size:
 * without it a 300 DPI file is read as 72 DPI and appears four times too large.
 */
export function withPngDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254); // pixels per metre
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9); // data length
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const ihdrEnd = 8 + 25; // signature + IHDR chunk (always first, 13 bytes of data)
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/**
 * Renders one printed side as a real-size transparent PNG (default 300 DPI). Falls back to 200 DPI when the
 * device cannot allocate a canvas that large (some phones cap canvases at ~16.7 million pixels).
 */
export async function renderPrintFile(specs, side, dpi = PRINT_DPI) {
  const g = garmentOf(specs);
  const area = PRINT_AREAS[g][side];
  const layers = allLayers(specs).filter((l) => l.side === side);
  await loadDesignFonts(specs);
  const images = new Map();
  for (const l of layers) {
    if (l.kind === 'image') {
      const { img } = await loadImage(l.url);
      if (!img) throw new Error(`Image ${l.index} on the ${SIDE_LABEL[side].toLowerCase()} could not be loaded. Check the connection and try again.`);
      images.set(l.url, img);
    }
  }
  for (const tryDpi of dpi >= 300 ? [dpi, 200] : [dpi]) {
    const pxPerUnit = tryDpi / CM_PER_INCH / UNITS_PER_CM;
    const width = Math.round(area.w * pxPerUnit);
    const height = Math.round(area.h * pxPerUnit);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.scale(pxPerUnit, pxPerUnit);
    const warnings = new Set();
    for (const l of layers) drawLayer(ctx, l, area, null, images, warnings);
    // eslint-disable-next-line no-await-in-loop
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    canvas.width = canvas.height = 0; // free the memory straight away
    if (blob) {
      const bytes = withPngDpi(new Uint8Array(await blob.arrayBuffer()), tryDpi);
      return { bytes, dpi: tryDpi, width, height, widthCm: cm(area.w), heightCm: cm(area.h) };
    }
  }
  throw new Error('This device ran out of memory while creating the print file. Try again on a computer.');
}

/** Front and back flat views (JPEG data URLs), cut from the same texture the 3D model uses. */
async function renderFlatViews(specs) {
  // Garments with a photo preview get realistic front/back pictures; the others the flat 2D views.
  const { hasPhotoMockup, photoMockupDataUrl, PHOTO_SIZE } = await import('./photoMockup.js');
  if (hasPhotoMockup(specs.garmentType)) {
    try {
      const [front, back] = await Promise.all([photoMockupDataUrl(specs, 'front'), photoMockupDataUrl(specs, 'back')]);
      return { front, back, aspect: PHOTO_SIZE.height / PHOTO_SIZE.width };
    } catch {
      /* fall back to the flat views */
    }
  }
  const atlas = document.createElement('canvas');
  await paintDesignTexture(atlas, specs);
  const views = {};
  const faceW = VIEW_W * TEXTURE_SCALE;
  for (const [face, offset] of [['front', 0], ['back', faceW]]) {
    const out = document.createElement('canvas');
    out.width = faceW;
    out.height = TEXTURE_HEIGHT;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(atlas, offset, 0, faceW, TEXTURE_HEIGHT, 0, 0, faceW, TEXTURE_HEIGHT);
    views[face] = out.toDataURL('image/jpeg', 0.85);
  }
  atlas.width = atlas.height = 0;
  return { ...views, aspect: TEXTURE_HEIGHT / (TEXTURE_WIDTH / 2) };
}

/** PDF text: standard fonts cover Latin-1 only (× and ° included); other characters are dropped. */
const pdfText = (value) =>
  String(value ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

const BRAND = [79, 70, 229];
const INK = [23, 23, 28];
const MUTED = [100, 100, 115];
const LINE = [222, 221, 230];

/**
 * Builds the spec sheet. meta: { code, title, description, expectedDeliveryDays }.
 * Returns a jsPDF document (call .output('arraybuffer') or .save()).
 */
export async function buildSpecSheet(specs, meta = {}) {
  const [{ jsPDF }, views, rows] = await Promise.all([import('jspdf'), renderFlatViews(specs), describeLayers(specs)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  let y = 0;
  const font = (size, style = 'normal', color = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const text = (v, x, yy, opts) => doc.text(pdfText(v), x, yy, opts);
  const ensure = (needed) => {
    if (y + needed > H - 18) {
      doc.addPage();
      y = M;
    }
  };

  // Header band
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 26, 'F');
  font(16, 'bold', [255, 255, 255]);
  text('CustomT · Production spec sheet', M, 12);
  font(9, 'normal', [224, 231, 255]);
  text(`${meta.code || 'Draft design'}${meta.title ? `  ·  ${meta.title}` : ''}`, M, 19);
  text(`Generated ${new Date().toLocaleString()}`, W - M, 19, { align: 'right' });
  y = 34;

  // Summary
  const qty = Object.values(specs.sizeBreakdown || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  const summary = [
    ['Garment', specs.garmentType],
    ['Fabric', `${specs.fabric}, ${specs.gsm} GSM`],
    ['Print method', specs.printType],
    ['Quantity', `${qty} pcs`],
    ['Printed sides', printedSides(specs).map((s) => SIDE_LABEL[s]).join(', ') || '-'],
    ['Delivery', meta.expectedDeliveryDays ? `${meta.expectedDeliveryDays} days` : '-'],
  ];
  const colW = (W - 2 * M) / 3;
  summary.forEach(([k, v], i) => {
    const x = M + (i % 3) * colW;
    const yy = y + Math.floor(i / 3) * 12;
    font(7.5, 'normal', MUTED);
    text(k.toUpperCase(), x, yy);
    font(10, 'bold');
    text(v, x, yy + 5);
  });
  y += 26;
  font(7.5, 'normal', MUTED);
  text('BASE COLOUR', M, y);
  doc.setFillColor(specs.color || '#FFFFFF');
  doc.setDrawColor(...LINE);
  doc.roundedRect(M, y + 2, 10, 6, 1, 1, 'FD');
  font(10, 'bold');
  text((specs.color || '').toUpperCase(), M + 13, y + 6.6);
  const trims = TRIMS[garmentOf(specs)] || [];
  if (trims.length) {
    font(7.5, 'normal', MUTED);
    text('TRIMS (CUT SIZE, MATCHING COLOUR)', M + colW, y);
    font(9, 'normal');
    text(trims.map((t) => `${t.label} ${fmt(t.lengthCm)} × ${fmt(t.widthCm)} cm, cut ${t.cut}`).join('  ·  '), M + colW, y + 6.6);
  }
  y += 14;

  // Front / back views
  const imgW = (W - 2 * M - 6) / 2;
  const imgH = imgW * views.aspect;
  ensure(imgH + 10);
  ['front', 'back'].forEach((face, i) => {
    const x = M + i * (imgW + 6);
    doc.setDrawColor(...LINE);
    doc.roundedRect(x, y, imgW, imgH, 2, 2, 'S');
    doc.addImage(views[face], 'JPEG', x + 1, y + 1, imgW - 2, imgH - 2);
    font(8, 'bold', MUTED);
    text(face === 'front' ? 'FRONT' : 'BACK', x + imgW / 2, y + imgH + 4.5, { align: 'center' });
  });
  y += imgH + 10;

  // Size breakdown
  ensure(22);
  font(11, 'bold');
  text('Size breakdown', M, y);
  y += 3;
  const sizes = Object.entries(specs.sizeBreakdown || {});
  const cell = (W - 2 * M) / Math.max(1, sizes.length + 1);
  sizes.concat([['Total', qty]]).forEach(([size, n], i) => {
    const x = M + i * cell;
    doc.setDrawColor(...LINE);
    doc.rect(x, y, cell, 12);
    font(7.5, 'bold', MUTED);
    text(size, x + cell / 2, y + 4.5, { align: 'center' });
    font(10, 'bold');
    text(String(n), x + cell / 2, y + 10, { align: 'center' });
  });
  y += 20;

  // Prints, side by side
  font(11, 'bold');
  ensure(12);
  text('Prints: size and position', M, y);
  y += 2;
  font(7.5, 'normal', MUTED);
  y += 4;
  text("Size M. Positions are measured from the garment's centre line and from the high point of the shoulder (HPS).", M, y);
  y += 6;
  for (const side of printedSides(specs)) {
    const a = areaInfo(specs, side);
    ensure(16);
    doc.setFillColor(243, 242, 251);
    doc.rect(M, y - 4, W - 2 * M, 7, 'F');
    font(9.5, 'bold');
    text(SIDE_LABEL[side], M + 2, y + 0.8);
    font(8, 'normal', MUTED);
    text(`Print area ${fmt(a.w)} × ${fmt(a.h)} cm${a.where ? `, ${a.where}` : a.top !== null ? `, top edge ${fmt(a.top)} cm below HPS` : ''}  ·  print file ${side}_${fmt(a.w)}x${fmt(a.h)}cm_${PRINT_DPI}dpi.png`, W - M - 2, y + 0.8, { align: 'right' });
    y += 7;
    for (const row of rows.filter((r) => r.side === side)) {
      ensure(13);
      font(9, 'bold');
      text(row.label, M + 2, y + 1);
      font(8, 'normal', MUTED);
      text(row.detail, M + 2, y + 5.5);
      font(8.5, 'normal');
      text(`${row.size}  ·  rotation ${row.rotation}`, M + 72, y + 1);
      font(8, 'normal', MUTED);
      text(`${row.position}  ·  ${row.quality}`, M + 72, y + 5.5);
      doc.setDrawColor(...LINE);
      doc.line(M, y + 8, W - M, y + 8);
      y += 11;
    }
    y += 3;
  }

  if (meta.description) {
    ensure(20);
    font(11, 'bold');
    text('Notes from the buyer', M, y);
    y += 5;
    font(9, 'normal');
    const lines = doc.splitTextToSize(pdfText(meta.description), W - 2 * M);
    ensure(lines.length * 4.5);
    doc.text(lines, M, y);
    y += lines.length * 4.5 + 4;
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    font(7.5, 'normal', MUTED);
    text('Locked specification: the design cannot change after bidding opens. Print files are released to the awarded printer once escrow is funded.', M, H - 8);
    text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc;
}

const safeName = (s) => String(s || 'design').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design';
const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Downloads the spec sheet PDF (browser download, or the Android share sheet in the app). */
export async function downloadSpecSheet(specs, meta = {}) {
  const doc = await buildSpecSheet(specs, meta);
  const filename = `CustomT-spec-${safeName(meta.code)}.pdf`;
  const { saveGeneratedFile } = await import('../native/platform.js');
  return saveGeneratedFile({ filename, mimeType: 'application/pdf', base64: doc.output('datauristring').split(',')[1], fallback: () => doc.save(filename) });
}

/**
 * Builds and downloads the production pack ZIP: spec-sheet.pdf, one PNG per printed side and a README.
 * onProgress(message) reports each step (rendering 300 DPI files takes a few seconds per side).
 */
export async function downloadProductionPack(specs, meta = {}, onProgress = () => {}) {
  const [{ zipSync, strToU8 }, { isNativeApp, saveGeneratedFile }] = await Promise.all([import('fflate'), import('../native/platform.js')]);
  const files = {};
  const readme = [`CustomT production pack - ${meta.code || 'design'}${meta.title ? ` - ${meta.title}` : ''}`, ''];
  for (const side of printedSides(specs)) {
    onProgress(`Rendering the ${SIDE_LABEL[side].toLowerCase()} print file…`);
    // eslint-disable-next-line no-await-in-loop
    const file = await renderPrintFile(specs, side);
    const name = `${side}_${fmt(file.widthCm)}x${fmt(file.heightCm)}cm_${file.dpi}dpi.png`;
    files[name] = [file.bytes, { level: 0 }]; // PNG is already compressed
    readme.push(`${name}: ${SIDE_LABEL[side]}, ${fmt(file.widthCm)} x ${fmt(file.heightCm)} cm print area, ${file.width} x ${file.height} px at ${file.dpi} DPI, transparent background.`);
  }
  onProgress('Creating the spec sheet…');
  const doc = await buildSpecSheet(specs, meta);
  files['spec-sheet.pdf'] = [new Uint8Array(doc.output('arraybuffer')), { level: 6 }];
  readme.push(
    'spec-sheet.pdf: garment, colours, size breakdown and the exact size and position of every print.',
    '',
    'Each PNG covers the whole print area of its side at real size: place the print area as described in the spec sheet',
    '(top edge below the high point of the shoulder, centred on the garment) and the artwork lands exactly where it was designed.'
  );
  files['README.txt'] = strToU8(readme.join('\r\n'));
  onProgress('Packing the ZIP…');
  const zip = zipSync(files);
  const filename = `CustomT-production-pack-${safeName(meta.code)}.zip`;
  if (isNativeApp) return saveGeneratedFile({ filename, mimeType: 'application/zip', base64: toBase64(zip) });
  const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return undefined;
}
