import { useRef, useState } from 'react';
import { Crosshair, ImagePlus, Loader2, Trash2, Type } from 'lucide-react';
import { uploadApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Button, Field, Input, Select, cx } from '../ui';
import { SIDES, SIDE_LABEL } from '../../utils/garmentGeometry';
import { FONTS, LIMITS, defaultTextSize, fontFamily, fontWeight, newLayerId } from '../../utils/design';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_MB = 2;
const TEXT_SWATCHES = ['#FFFFFF', '#111827', '#DC2626', '#F59E0B', '#2563EB', '#15803D', '#D4AF37'];

/** Picks a readable default ink colour for the garment colour. */
function contrastInk(hex = '#FFFFFF') {
  const n = parseInt(hex.replace('#', ''), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff);
  return lum > 150 ? '#111827' : '#FFFFFF';
}

/** First free vertical slot on a side, so a new layer does not land on top of an existing one. */
function freeY(side, preferred, layers) {
  const taken = layers.filter((l) => l.side === side).map((l) => l.y);
  if (side === 'leftSleeve' || side === 'rightSleeve' || taken.length === 0) return preferred;
  return Math.min(88, Math.max(...taken) + 24);
}

/**
 * Edits the layered artwork: text and images on the front, back and both sleeves.
 * `side` is the side being edited (follows the preview tab); `selectedId` is shared with the preview so
 * clicking a layer on the garment selects it here, and vice versa.
 */
export default function ArtworkEditor({ specs, side, onSideChange, selectedId, onSelect, onChange }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(null);
  const textLayers = specs.textLayers || [];
  const imageLayers = specs.imageLayers || [];
  const sideLayers = [...imageLayers.map((l) => ({ ...l, kind: 'image' })), ...textLayers.map((l) => ({ ...l, kind: 'text' }))].filter((l) => l.side === side);
  const selectedText = textLayers.find((l) => l.id === selectedId);
  const selectedImage = imageLayers.find((l) => l.id === selectedId);
  const counts = Object.fromEntries(SIDES.map((s) => [s, textLayers.filter((l) => l.side === s).length + imageLayers.filter((l) => l.side === s).length]));

  const patchText = (id, patch) => onChange({ textLayers: textLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const patchImage = (id, patch) => onChange({ imageLayers: imageLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const remove = (id) => {
    onChange({ textLayers: textLayers.filter((l) => l.id !== id), imageLayers: imageLayers.filter((l) => l.id !== id) });
    if (id === selectedId) onSelect(null);
  };

  const addText = () => {
    if (textLayers.length >= LIMITS.maxText) {
      toast.error(`You can add up to ${LIMITS.maxText} text layers.`);
      return;
    }
    const sleeve = side === 'leftSleeve' || side === 'rightSleeve';
    const layer = {
      id: newLayerId('t'),
      side,
      text: sleeve ? 'NO 7' : 'YOUR TEXT',
      font: FONTS[0].name,
      size: defaultTextSize(side),
      color: contrastInk(specs.color),
      x: 50,
      y: freeY(side, sleeve ? 50 : 30, [...textLayers, ...imageLayers]),
    };
    onChange({ textLayers: [...textLayers, layer] });
    onSelect(layer.id);
  };

  const addImages = async (fileList) => {
    const files = [...(fileList || [])];
    if (fileRef.current) fileRef.current.value = '';
    const room = LIMITS.maxImages - imageLayers.length;
    if (room <= 0) {
      toast.error(`You can add up to ${LIMITS.maxImages} images.`);
      return;
    }
    if (files.length > room) toast.info(`Only the first ${room} image(s) were added (limit ${LIMITS.maxImages}).`);
    let added = [...imageLayers];
    let lastId = null;
    for (const file of files.slice(0, room)) {
      if (!ACCEPT.includes(file.type)) {
        toast.error(`${file.name}: please choose a PNG, JPG, WEBP or SVG image.`);
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        toast.error(`${file.name} is larger than ${MAX_MB} MB.`);
        continue;
      }
      setUploading({ name: file.name, progress: 0 });
      try {
        const res = await uploadApi.logo(file, (progress) => setUploading({ name: file.name, progress }));
        const sleeve = side === 'leftSleeve' || side === 'rightSleeve';
        const layer = { id: newLayerId('i'), side, url: res.url, x: 50, y: freeY(side, sleeve ? 50 : 25, [...textLayers, ...added]), scale: sleeve ? 0.6 : 0.45 };
        added = [...added, layer];
        lastId = layer.id;
        onChange({ imageLayers: added });
      } catch (err) {
        toast.error(`${file.name}: ${err.message}`);
      }
    }
    setUploading(null);
    if (lastId) {
      onSelect(lastId);
      toast.success('Image added. Drag it on the preview to position it.');
    }
  };

  const moveToSide = (layer, nextSide) => {
    const patch = { side: nextSide, x: 50, y: 50 };
    if (layer.kind === 'text') patchText(layer.id, { ...patch, size: Math.min(layer.size, defaultTextSize(nextSide) * 2) });
    else patchImage(layer.id, patch);
    onSideChange(nextSide);
  };

  const selected = selectedText ? { ...selectedText, kind: 'text' } : selectedImage ? { ...selectedImage, kind: 'image' } : null;

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Side you are designing</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {SIDES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSideChange(s)}
              className={cx(
                'flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition',
                side === s ? 'border-brand-500 bg-brand-50 font-semibold text-brand-800 ring-2 ring-brand-200' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              )}
            >
              {SIDE_LABEL[s]}
              {counts[s] > 0 && <span className="ml-2 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{counts[s]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={Type} onClick={addText}>
          Add text
        </Button>
        <Button variant="secondary" icon={uploading ? Loader2 : ImagePlus} disabled={Boolean(uploading)} onClick={() => fileRef.current?.click()}>
          {uploading ? `Uploading ${uploading.progress}%…` : 'Add image(s)'}
        </Button>
        <input ref={fileRef} type="file" multiple accept={ACCEPT.join(',')} className="hidden" onChange={(e) => addImages(e.target.files)} />
      </div>
      <p className="-mt-2 text-xs text-slate-500">
        Adds to the {SIDE_LABEL[side].toLowerCase()}. PNG with a transparent background works best · max {MAX_MB} MB each · up to {LIMITS.maxImages} images and {LIMITS.maxText} texts.
      </p>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Layers on the {SIDE_LABEL[side].toLowerCase()}</p>
        {sideLayers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">Nothing on this side yet. Add text or an image.</p>
        ) : (
          <ul className="space-y-1.5">
            {sideLayers.map((l) => (
              <li key={l.id}>
                <div
                  className={cx(
                    'flex items-center gap-3 rounded-xl border px-2 py-1.5 transition',
                    l.id === selectedId ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
                  )}
                >
                  <button type="button" onClick={() => onSelect(l.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    {l.kind === 'image' ? (
                      <span className="checkerboard flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200">
                        <img src={l.url} alt="" className="max-h-full max-w-full object-contain" />
                      </span>
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-800 text-sm" style={{ color: l.color, fontFamily: fontFamily(l.font), fontWeight: fontWeight(l.font) }}>
                        Aa
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{l.kind === 'image' ? 'Image' : l.text || '(empty text)'}</span>
                      <span className="block text-xs text-slate-500">{l.kind === 'image' ? `${Math.round(l.scale * 100)}% width` : `${l.font} · ${l.size}px`}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => remove(l.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete layer">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && selected.side === side && (
        <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">{selected.kind === 'text' ? 'Edit text' : 'Edit image'}</p>
            <button
              type="button"
              onClick={() => (selected.kind === 'text' ? patchText : patchImage)(selected.id, { x: 50, y: 50 })}
              className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
            >
              <Crosshair className="h-3.5 w-3.5" /> Centre on {SIDE_LABEL[side].toLowerCase()}
            </button>
          </div>

          {selected.kind === 'text' && (
            <>
              <Field label="Text" hint={`${selected.text.length}/${LIMITS.textMax} characters`} error={selected.text.trim() ? null : 'Enter some text or delete this layer'}>
                <Input value={selected.text} maxLength={LIMITS.textMax} onChange={(e) => patchText(selected.id, { text: e.target.value })} invalid={!selected.text.trim()} />
              </Field>
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">Font</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {FONTS.map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      onClick={() => patchText(selected.id, { font: f.name })}
                      className={cx(
                        'truncate rounded-lg border bg-white px-3 py-2 text-left text-base transition',
                        selected.font === f.name ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200 hover:bg-slate-50'
                      )}
                      style={{ fontFamily: fontFamily(f.name), fontWeight: f.weight }}
                      title={f.label}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="text-size" className="flex items-center justify-between text-sm font-medium text-slate-700">
                  Font size <span className="font-mono text-xs">{selected.size}px</span>
                </label>
                <input
                  id="text-size"
                  type="range"
                  min={LIMITS.sizeMin}
                  max={LIMITS.sizeMax}
                  value={selected.size}
                  onChange={(e) => patchText(selected.id, { size: Number(e.target.value) })}
                  className="mt-1 w-full accent-brand-600"
                />
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">Ink / thread colour</p>
                <div className="flex flex-wrap items-center gap-2">
                  {TEXT_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      aria-label={`Text colour ${hex}`}
                      onClick={() => patchText(selected.id, { color: hex })}
                      className={cx('h-7 w-7 rounded-full border border-slate-300', selected.color.toUpperCase() === hex ? 'ring-2 ring-brand-500 ring-offset-2' : '')}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                  <input
                    type="color"
                    value={selected.color}
                    onChange={(e) => patchText(selected.id, { color: e.target.value.toUpperCase() })}
                    className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                    aria-label="Custom text colour"
                  />
                </div>
              </div>
            </>
          )}

          {selected.kind === 'image' && (
            <div>
              <label htmlFor="image-size" className="flex items-center justify-between text-sm font-medium text-slate-700">
                Image size <span className="font-mono text-xs">{Math.round(selected.scale * 100)}% of print area</span>
              </label>
              <input
                id="image-size"
                type="range"
                min={LIMITS.scaleMin}
                max={LIMITS.scaleMax}
                step="0.01"
                value={selected.scale}
                onChange={(e) => patchImage(selected.id, { scale: Number(e.target.value) })}
                className="mt-1 w-full accent-brand-600"
              />
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Field label="Move to side">
              <Select value={selected.side} onChange={(e) => moveToSide(selected, e.target.value)}>
                {SIDES.map((s) => (
                  <option key={s} value={s}>
                    {SIDE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="ghost" icon={Trash2} onClick={() => remove(selected.id)} className="text-red-600 hover:bg-red-50">
              Delete
            </Button>
          </div>
          <p className="text-xs text-slate-500">Drag the layer on the preview, or select it and use the arrow keys (Shift = bigger steps).</p>
        </div>
      )}
    </div>
  );
}
