/**
 * Photo preview ("mockup"): the design on a realistic photo of the garment, in any fabric colour.
 *
 * Each photo is a grey "shading map" (the garment photographed in light grey, transparent background,
 * 800 × 900 px). Rendering:
 *  1. Recolour: every pixel's grey level (fabric shading) is multiplied by the chosen colour, with extra
 *     fold contrast on dark colours so a black shirt still shows its folds.
 *  2. Print: the design's layers are drawn with the same code as the print files (drawLayer), placed by real
 *     centimetres measured from the high point of the shoulder (HPS) and the centre line.
 *  3. Fabric: the print is multiplied by the shading map, so it follows the folds, and kept inside the garment.
 *
 * Calibration per photo (measured from the photo's alpha mask): cx = centre line, hpsY = shoulder line,
 * hemY = hem, chestPx = body width. The photos are taller than a real garment, so vertical positions use
 * length scale (HPS → hem) and the artwork uses one uniform scale from the chest width. The photo view is
 * for look and feel; exact sizes are in the 2D editor, spec sheet and print files.
 */
import { HEM_CORNER, HPS_Y, PRINT_AREAS, VIEW_W } from './garmentGeometry.js';
import { layersOf, textExtent } from './design.js';
import { drawLayer, loadDesignFonts, loadImage } from './designTexture.js';

export const PHOTO_SIZE = { width: 800, height: 900 };

const CREW_BACK = { src: '/mockups/tee-back.png', cx: 394.5, hpsY: 40, hemY: 859, chestPx: 367 };
export const PHOTO_MOCKUPS = {
  'Crew Neck': { front: { src: '/mockups/crew-front.png', cx: 399.5, hpsY: 42, hemY: 859, chestPx: 367 }, back: CREW_BACK },
  'V-Neck': { front: { src: '/mockups/vneck-front.png', cx: 399, hpsY: 41, hemY: 858, chestPx: 370 }, back: CREW_BACK },
  Polo: {
    front: { src: '/mockups/polo-front.png', cx: 403, hpsY: 44, hemY: 859, chestPx: 344 },
    back: { src: '/mockups/polo-back.png', cx: 397, hpsY: 44, hemY: 859, chestPx: 356 },
  },
};

/** Garment length (HPS → hem at the centre) in design units, for vertical placement on the photos. */
const LENGTH_UNITS = { 'Crew Neck': 400, 'V-Neck': 400, Polo: 400 }; // HPS → hem at the centre

export const hasPhotoMockup = (garment) => Boolean(PHOTO_MOCKUPS[garment]);

const mapCache = new Map();
/** Loads a shading map once and keeps its pixels (grey + alpha) for recolouring. */
function loadMap(src) {
  if (!mapCache.has(src)) {
    mapCache.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = PHOTO_SIZE.width;
          c.height = PHOTO_SIZE.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(ctx.getImageData(0, 0, c.width, c.height));
        };
        img.onerror = () => {
          mapCache.delete(src);
          reject(new Error('The garment photo could not be loaded.'));
        };
        img.src = src;
      })
    );
  }
  return mapCache.get(src);
}

/** Colour × shading. Plain fabric in the maps is ~0.8 grey; dark colours get extra fold contrast. */
function tintFactors(hex) {
  const n = parseInt(String(hex || '#ffffff').replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const c = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const k = 0.5 * (1 - lum) ** 2;
  return c.map((v) => ({ mul: 1.1625 * v + 1.25 * k, add: -k }));
}

/**
 * How the design space maps onto a photo: k = photo px per design unit for artwork and horizontal positions
 * (from the chest width), ky = photo px per design unit for vertical positions (shoulder line → hem).
 */
export function photoPlacement(specs, face) {
  const garment = specs.garmentType;
  const photo = PHOTO_MOCKUPS[garment]?.[face];
  if (!photo) return null;
  const chestUnits = 2 * (HEM_CORNER[garment][0] - VIEW_W / 2);
  return {
    garment,
    photo,
    area: PRINT_AREAS[garment][face],
    k: photo.chestPx / chestUnits,
    ky: (photo.hemY - photo.hpsY) / LENGTH_UNITS[garment],
  };
}

/** Photo pixel position of a layer's centre. */
export function layerToPhoto(place, layer) {
  const { photo, area, k, ky, garment } = place;
  const gx = area.cx - area.w / 2 + (layer.x / 100) * area.w;
  const gy = area.cy - area.h / 2 + (layer.y / 100) * area.h;
  return { px: photo.cx + (gx - VIEW_W / 2) * k, py: photo.hpsY + (gy - HPS_Y[garment]) * ky };
}

/** Inverse of layerToPhoto: the layer position (% of its print area, clamped) for a photo pixel. */
export function photoToLayer(place, px, py) {
  const { photo, area, k, ky, garment } = place;
  const gx = VIEW_W / 2 + (px - photo.cx) / k;
  const gy = HPS_Y[garment] + (py - photo.hpsY) / ky;
  const pct = (v) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  return { x: pct(((gx - (area.cx - area.w / 2)) / area.w) * 100), y: pct(((gy - (area.cy - area.h / 2)) / area.h) * 100) };
}

/** Hit boxes of a face's layers on the photo (for selecting and dragging): centre, size and rotation in photo px. */
export async function photoLayerBoxes(specs, face) {
  const place = photoPlacement(specs, face);
  if (!place) return [];
  const { textLayers, imageLayers } = layersOf(specs);
  const layers = [...imageLayers.map((l) => ({ ...l, kind: 'image' })), ...textLayers.map((l) => ({ ...l, kind: 'text' }))].filter((l) => l.side === face);
  if (layers.some((l) => l.kind === 'text')) await loadDesignFonts(specs);
  return Promise.all(
    layers.map(async (l) => {
      let w;
      let h;
      if (l.kind === 'text') ({ w, h } = textExtent(l));
      else {
        const box = l.scale * place.area.w;
        const { img } = await loadImage(l.url);
        const ratio = img ? img.naturalWidth / img.naturalHeight || 1 : 1;
        w = ratio >= 1 ? box : box * ratio;
        h = ratio >= 1 ? box / ratio : box;
      }
      const { px, py } = layerToPhoto(place, l);
      return { id: l.id, px, py, w: w * place.k, h: Math.max(h, l.kind === 'text' ? l.size * 0.9 : h) * place.k, rotation: Number(l.rotation) || 0 };
    })
  );
}

const tintCache = new Map();
/** Recoloured garment pixels, cached per photo and colour (dragging re-renders only the print). */
function tintedGarment(map, src, color) {
  const key = `${src}|${color}`;
  if (tintCache.has(key)) return tintCache.get(key);
  const { width: W, height: H } = PHOTO_SIZE;
  const out = new ImageData(W, H);
  const t = tintFactors(color);
  const m = map.data;
  const g = out.data;
  for (let i = 0; i < m.length; i += 4) {
    const grey = m[i] / 255;
    g[i] = Math.max(0, Math.min(255, (t[0].mul * grey + t[0].add) * 255));
    g[i + 1] = Math.max(0, Math.min(255, (t[1].mul * grey + t[1].add) * 255));
    g[i + 2] = Math.max(0, Math.min(255, (t[2].mul * grey + t[2].add) * 255));
    g[i + 3] = m[i + 3];
  }
  tintCache.set(key, out);
  if (tintCache.size > 8) tintCache.delete(tintCache.keys().next().value);
  return out;
}

/**
 * Renders the photo preview of one face ('front' | 'back') into a new canvas (800 × 900).
 * Sleeve prints are not shown (the photos are straight-on); the 3D view shows them.
 */
export async function renderPhotoMockup(specs, face = 'front') {
  const garment = specs.garmentType;
  const photo = PHOTO_MOCKUPS[garment]?.[face];
  if (!photo) throw new Error('No photo preview for this garment yet.');
  const { width: W, height: H } = PHOTO_SIZE;
  const map = await loadMap(photo.src);

  // 1. Recoloured garment.
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  octx.putImageData(tintedGarment(map, photo.src, specs.color || '#FFFFFF'), 0, 0);
  const m = map.data;

  // 2. Print layers of this face, placed in real centimetres.
  const { textLayers, imageLayers } = layersOf(specs);
  const layers = [...imageLayers.map((l) => ({ ...l, kind: 'image' })), ...textLayers.map((l) => ({ ...l, kind: 'text' }))].filter((l) => l.side === face);
  if (layers.length) {
    await loadDesignFonts(specs);
    const images = new Map();
    await Promise.all(
      layers
        .filter((l) => l.kind === 'image')
        .map(async (l) => {
          const { img } = await loadImage(l.url);
          if (img) images.set(l.url, img);
        })
    );
    const place = photoPlacement(specs, face);
    const { area, k } = place;
    const print = document.createElement('canvas');
    print.width = W;
    print.height = H;
    const pctx = print.getContext('2d', { willReadFrequently: true });
    const warnings = new Set();
    for (const layer of layers) {
      const lx = (layer.x / 100) * area.w;
      const ly = (layer.y / 100) * area.h;
      const { px, py } = layerToPhoto(place, layer);
      pctx.setTransform(k, 0, 0, k, px - k * lx, py - k * ly);
      drawLayer(pctx, layer, area, null, images, warnings);
    }
    pctx.setTransform(1, 0, 0, 1, 0, 0);

    // 3. Fabric: follow the folds (multiply by the shading map) and stay on the garment.
    const pr = pctx.getImageData(0, 0, W, H);
    const p = pr.data;
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const fold = Math.min(1, (m[i] / 255) * 1.25);
      p[i] *= fold;
      p[i + 1] *= fold;
      p[i + 2] *= fold;
      p[i + 3] = (p[i + 3] * m[i + 3]) / 255;
    }
    pctx.putImageData(pr, 0, 0);
    octx.drawImage(print, 0, 0);
  }
  return out;
}

/** Same as renderPhotoMockup, as a JPEG data URL on a background colour (for PDFs). */
export async function photoMockupDataUrl(specs, face, background = '#ffffff') {
  const canvas = await renderPhotoMockup(specs, face);
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat.toDataURL('image/jpeg', 0.88);
}

