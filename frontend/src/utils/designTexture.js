/**
 * Paints a design onto a texture atlas for the 3D garment models.
 *
 * Atlas layout (matches scripts/build-garment-models.mjs):
 *   left half  (u 0 - 0.5) = front view, exactly as the 2D front preview
 *   right half (u 0.5 - 1) = back view, exactly as the 2D back preview (seen from behind)
 * v runs top to bottom (glTF convention), so the CanvasTexture must use flipY = false.
 */
import { BODY, PRINT_AREAS, SIDES, SIDE_FACE, VIEW_H, VIEW_W, detailsFor, shade } from './garmentGeometry';
import { fontFamily, fontWeight, fontsUsed, layersOf } from './design';

export const TEXTURE_SCALE = 2.5;
export const TEXTURE_WIDTH = 2 * VIEW_W * TEXTURE_SCALE;
export const TEXTURE_HEIGHT = VIEW_H * TEXTURE_SCALE;

const imageCache = new Map();
const pathCache = new Map();

const path2d = (d) => {
  if (!pathCache.has(d)) pathCache.set(d, new Path2D(d));
  return pathCache.get(d);
};

/** Loads an image for canvas use. Resolves null (never rejects) so one broken image cannot block the model. */
export function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => {
          imageCache.delete(url);
          resolve(null);
        };
        img.src = url;
      })
    );
  }
  return imageCache.get(url);
}

/** Waits for the web fonts a design uses, so canvas text is not drawn in a fallback font. */
export async function loadDesignFonts(specs) {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  await Promise.all(fontsUsed(specs).map((name) => document.fonts.load(`${fontWeight(name)} 48px '${name}'`).catch(() => null)));
}

function fabricPattern(ctx, fabric) {
  const tile = document.createElement('canvas');
  const s = TEXTURE_SCALE;
  const t = tile.getContext('2d');
  if (fabric === 'Pique/Crocodile') {
    tile.width = tile.height = Math.round(6 * s);
    t.fillStyle = 'rgba(0,0,0,0.09)';
    t.beginPath();
    t.arc(3 * s, 3 * s, 1.15 * s, 0, Math.PI * 2);
    t.fill();
    t.fillStyle = 'rgba(255,255,255,0.08)';
    t.beginPath();
    t.arc(0, 0, 0.8 * s, 0, Math.PI * 2);
    t.fill();
  } else if (fabric === 'Dry-Fit/Wetlook') {
    tile.width = Math.round(7 * s);
    tile.height = Math.round(6 * s);
    t.fillStyle = 'rgba(0,0,0,0.11)';
    for (const [x, y] of [[1.75, 1.5], [5.25, 4.5]]) {
      t.beginPath();
      t.arc(x * s, y * s, 1.05 * s, 0, Math.PI * 2);
      t.fill();
    }
  } else {
    tile.width = tile.height = Math.round(6 * s);
    t.strokeStyle = 'rgba(0,0,0,0.05)';
    t.lineWidth = 1.4 * s;
    t.beginPath();
    t.moveTo(0, 0);
    t.lineTo(tile.width, tile.height);
    t.stroke();
  }
  return ctx.createPattern(tile, 'repeat');
}

function drawLayer(ctx, layer, area, printType, images, warnings) {
  const cx = (layer.x / 100) * area.w;
  const cy = (layer.y / 100) * area.h;
  ctx.save();
  if (printType === 'Sublimation') ctx.globalAlpha = 0.88;
  if (printType === 'DTF' || printType === 'Embroidery') {
    ctx.shadowColor = `rgba(0,0,0,${printType === 'Embroidery' ? 0.55 : 0.3})`;
    ctx.shadowOffsetY = (printType === 'Embroidery' ? 1.3 : 0.8) * TEXTURE_SCALE;
    ctx.shadowBlur = TEXTURE_SCALE;
  }
  if (layer.kind === 'image') {
    const img = images.get(layer.url);
    if (img) {
      const box = layer.scale * area.w;
      const ratio = img.naturalWidth / img.naturalHeight || 1;
      const w = ratio >= 1 ? box : box * ratio;
      const h = ratio >= 1 ? box / ratio : box;
      try {
        ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      } catch {
        warnings.add('An image could not be drawn on the 3D model.');
      }
    }
  } else {
    ctx.font = `${fontWeight(layer.font)} ${layer.size}px ${fontFamily(layer.font)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = layer.color;
    ctx.fillText(layer.text, cx, cy);
    if (printType === 'Embroidery') {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = shade(layer.color, -35);
      ctx.lineWidth = Math.max(0.4, layer.size / 30);
      ctx.setLineDash([2.2, 1.4]);
      ctx.strokeText(layer.text, cx, cy);
    }
  }
  ctx.restore();
}

function paintFace(ctx, face, offsetX, specs, layers, images, warnings, pattern) {
  const garment = BODY[specs.garmentType] ? specs.garmentType : 'Crew Neck';
  const color = specs.color || '#FFFFFF';
  const body = path2d(BODY[garment]);
  const k = TEXTURE_SCALE;

  ctx.save();
  ctx.setTransform(k, 0, 0, k, offsetX, 0);
  // Base colour covers the whole half so texture filtering never pulls in a foreign colour at the seams.
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, offsetX, 0);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, VIEW_W * k, VIEW_H * k);
  ctx.restore();

  for (const d of detailsFor(garment, face)) {
    const p = path2d(d.d);
    if (d.fill !== undefined) {
      ctx.fillStyle = shade(color, d.fill);
      ctx.fill(p);
    }
    if (d.stroke !== undefined) {
      ctx.strokeStyle = shade(color, d.stroke);
      ctx.lineWidth = d.width || 1;
      ctx.setLineDash(d.dash || []);
      ctx.lineCap = d.cap || 'butt';
      ctx.lineJoin = d.join || 'miter';
      ctx.stroke(p);
    }
  }
  ctx.setLineDash([]);

  ctx.clip(body);
  const areas = PRINT_AREAS[garment];
  for (const side of SIDES.filter((s) => SIDE_FACE[s] === face)) {
    const area = areas[side];
    ctx.save();
    ctx.translate(area.cx, area.cy);
    ctx.rotate((area.rotate * Math.PI) / 180);
    ctx.translate(-area.w / 2, -area.h / 2);
    for (const layer of layers.filter((l) => l.side === side)) drawLayer(ctx, layer, area, specs.printType, images, warnings);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Paints the full design onto `canvas` (resized to the atlas size if needed).
 * Returns a list of human-readable warnings (e.g. images that could not be loaded).
 */
export async function paintDesignTexture(canvas, specs) {
  const warnings = new Set();
  const { textLayers, imageLayers } = layersOf(specs);
  const layers = [...imageLayers.map((l) => ({ ...l, kind: 'image' })), ...textLayers.map((l) => ({ ...l, kind: 'text' }))];

  const [, loaded] = await Promise.all([loadDesignFonts(specs), Promise.all([...new Set(imageLayers.map((l) => l.url))].map(async (url) => [url, await loadImage(url)]))]);
  const images = new Map();
  for (const [url, img] of loaded) {
    if (img) images.set(url, img);
    else warnings.add('One of the uploaded images could not be loaded for the 3D view. It is still part of your design.');
  }

  if (canvas.width !== TEXTURE_WIDTH) canvas.width = TEXTURE_WIDTH;
  if (canvas.height !== TEXTURE_HEIGHT) canvas.height = TEXTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const pattern = fabricPattern(ctx, specs.fabric);
  paintFace(ctx, 'front', 0, specs, layers, images, warnings, pattern);
  paintFace(ctx, 'back', VIEW_W * TEXTURE_SCALE, specs, layers, images, warnings, pattern);
  return [...warnings];
}
