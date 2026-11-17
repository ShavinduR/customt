import { useEffect, useRef, useState } from 'react';
import { Crosshair, Hand, ImagePlus, Loader2, Maximize, Minus, MousePointer2, MousePointerClick, PenTool, Plus, RotateCcw, RotateCw, Scissors, Shirt, Trash2, Type } from 'lucide-react';
import { uploadApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { cx } from '../ui';
import TShirtPreview from '../configurator/TShirtPreview';
import { SIDES, SIDE_LABEL } from '../../utils/garmentGeometry';
import { FONTS, LIMITS, defaultTextSize, fontFamily, fontWeight, newLayerId, normRotation } from '../../utils/design';
import { Group, IconButton, Kbd, Panel, Segmented, Slider, StudioButton, studioInput } from './StudioUI';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_MB = 2;
const TEXT_SWATCHES = ['#FFFFFF', '#111827', '#DC2626', '#F59E0B', '#2563EB', '#15803D', '#D4AF37'];
const SHORT_LABEL = { front: 'Front', back: 'Back', leftSleeve: 'L sleeve', rightSleeve: 'R sleeve' };
const isSleeve = (side) => side === 'leftSleeve' || side === 'rightSleeve';

/** Picks a readable default ink colour for the garment colour. */
function contrastInk(hex = '#FFFFFF') {
  const n = parseInt(hex.replace('#', ''), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff);
  return lum > 150 ? '#111827' : '#FFFFFF';
}

/** First free vertical slot on a side, so a new layer does not land on top of an existing one. */
function freeY(side, preferred, layers) {
  const taken = layers.filter((l) => l.side === side).map((l) => l.y);
  if (isSleeve(side) || taken.length === 0) return preferred;
  return Math.min(88, Math.max(...taken) + 24);
}

export const allLayersOf = (specs) => [...specs.imageLayers.map((l) => ({ ...l, kind: 'image' })), ...specs.textLayers.map((l) => ({ ...l, kind: 'text' }))];

/**
 * Artwork actions shared by both panels. `update(patchOrFn, { group })` writes through the undo history:
 * a `group` merges rapid edits (typing, sliders, drags) into a single undo step.
 */
export function useArtwork({ specs, update, side, onSelect }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(null);

  const patchLayer = (id, patch, group) =>
    update(
      (s) => ({
        textLayers: s.textLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        imageLayers: s.imageLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      }),
      { group: group ? `${group}:${id}` : undefined }
    );

  const remove = (id) => {
    update((s) => ({ textLayers: s.textLayers.filter((l) => l.id !== id), imageLayers: s.imageLayers.filter((l) => l.id !== id) }));
    onSelect(null);
  };

  const addText = () => {
    if (specs.textLayers.length >= LIMITS.maxText) {
      toast.error(`You can add up to ${LIMITS.maxText} text layers.`);
      return;
    }
    const layer = {
      id: newLayerId('t'),
      side,
      text: isSleeve(side) ? 'NO 7' : 'YOUR TEXT',
      font: FONTS[0].name,
      size: defaultTextSize(side),
      color: contrastInk(specs.color),
      x: 50,
      y: freeY(side, isSleeve(side) ? 50 : 30, allLayersOf(specs)),
      rotation: 0,
    };
    update((s) => ({ textLayers: [...s.textLayers, layer] }));
    onSelect(layer.id);
  };

  const addImages = async (fileList) => {
    const files = [...(fileList || [])];
    if (fileRef.current) fileRef.current.value = '';
    const room = LIMITS.maxImages - specs.imageLayers.length;
    if (room <= 0) {
      toast.error(`You can add up to ${LIMITS.maxImages} images.`);
      return;
    }
    if (files.length > room) toast.info(`Only the first ${room} image(s) were added (limit ${LIMITS.maxImages}).`);
    let placed = allLayersOf(specs);
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
        const layer = { id: newLayerId('i'), side, url: res.url, x: 50, y: freeY(side, isSleeve(side) ? 50 : 25, placed), scale: isSleeve(side) ? 0.6 : 0.45, rotation: 0 };
        placed = [...placed, layer];
        lastId = layer.id;
        update((s) => ({ imageLayers: [...s.imageLayers, layer] }));
      } catch (err) {
        toast.error(`${file.name}: ${err.message}`);
      }
    }
    setUploading(null);
    if (lastId) {
      onSelect(lastId);
      toast.success('Image added. Drag it on the pattern to position it.');
    }
  };

  const moveToSide = (layer, nextSide) => {
    const patch = { side: nextSide, x: 50, y: 50 };
    if (layer.kind === 'text') patch.size = Math.min(layer.size, defaultTextSize(nextSide) * 2);
    patchLayer(layer.id, patch);
  };

  // Rendered ONCE by the page (both panels share this ref).
  const fileInput = <input ref={fileRef} type="file" multiple accept={ACCEPT.join(',')} className="hidden" onChange={(e) => addImages(e.target.files)} />;
  const pickImages = () => fileRef.current?.click();

  return { patchLayer, remove, addText, pickImages, fileInput, uploading, moveToSide };
}

function AddButtons({ art, compact = false }) {
  return (
    <div className={cx('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2')}>
      <StudioButton icon={Type} onClick={art.addText}>
        Add text
      </StudioButton>
      <StudioButton icon={art.uploading ? Loader2 : ImagePlus} loading={Boolean(art.uploading)} onClick={art.pickImages}>
        {art.uploading ? `${art.uploading.progress}%` : 'Add image'}
      </StudioButton>
    </div>
  );
}

function LayerThumb({ layer }) {
  if (layer.kind === 'image') {
    return (
      <span className="checkerboard flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md ring-1 ring-white/10">
        <img src={layer.url} alt="" className="max-h-full max-w-full object-contain" style={{ transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined }} />
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-sm ring-1 ring-white/10" style={{ color: layer.color, fontFamily: fontFamily(layer.font), fontWeight: fontWeight(layer.font) }}>
      Aa
    </span>
  );
}

const EDITOR_MODE_KEY = 'customt_editor_mode';
const EDITOR_MODES = [
  { value: 'pattern', label: 'Pattern', icon: Scissors },
  { value: 'garment', label: 'Garment', icon: Shirt },
];
function loadEditorMode() {
  try {
    return localStorage.getItem(EDITOR_MODE_KEY) === 'garment' ? 'garment' : 'pattern';
  } catch {
    return 'pattern';
  }
}

function RailButton({ icon: Icon, label, active, onClick, shortcut }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cx(
        'flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
        active ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/30' : 'text-zinc-300 hover:bg-white/10 hover:text-white'
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/**
 * 2D EDITOR (left half in split view).
 *  Pattern mode (default): the garment cut into flat pieces (front, back, both sleeves). Click a piece to work
 *    on it, drag layers, scroll to zoom, drag empty space (or use the hand tool) to pan.
 *  Garment mode: one side of the assembled garment, as large as the panel allows.
 * Both edit the same layers, so the 3D view always matches.
 */
export function PatternEditor({ specs, side, onSideChange, selectedId, onSelect, onLayerMove, art, className, ...rest }) {
  const preview = useRef(null);
  const [mode, setModeState] = useState(loadEditorMode);
  const [tool, setTool] = useState('select');
  const [zoom, setZoom] = useState(1);
  const pattern = mode === 'pattern';
  const layers = allLayersOf(specs);
  const counts = Object.fromEntries(SIDES.map((s) => [s, layers.filter((l) => l.side === s).length]));
  const selected = layers.find((l) => l.id === selectedId && (pattern || l.side === side));
  const rotation = Number(selected?.rotation) || 0;

  const setMode = (m) => {
    setModeState(m);
    try {
      localStorage.setItem(EDITOR_MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  // V = select, H = hand (pattern mode), like common design tools. Ignored while typing.
  useEffect(() => {
    if (!pattern) return undefined;
    const onKey = (e) => {
      const t = e.target;
      if (e.ctrlKey || e.metaKey || e.altKey || (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'h' || e.key === 'H') setTool('hand');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pattern]);

  return (
    <Panel className={className} {...rest}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
            <PenTool className="h-3.5 w-3.5 text-brand-400" /> 2D editor
          </h2>
          <Segmented size="sm" label="Editor view" value={mode} onChange={setMode} options={EDITOR_MODES} />
        </div>
        {pattern ? (
          <span className="text-[11px] text-zinc-500">
            4 pieces · working on <span className="font-semibold text-brand-300">{SIDE_LABEL[side]}</span>
          </span>
        ) : (
          <Segmented size="sm" label="Side" value={side} onChange={onSideChange} className="w-full sm:w-auto" options={SIDES.map((s) => ({ value: s, label: SHORT_LABEL[s], badge: counts[s] || null }))} />
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-zinc-950 [background-image:radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:16px_16px]">
        <div className={cx('absolute inset-0 pb-16 pt-3', pattern ? 'pl-14 pr-3' : 'px-3')}>
          <TShirtPreview
            ref={preview}
            specs={specs}
            view={side}
            mode={mode}
            activeSide={side}
            onPieceSelect={onSideChange}
            tool={tool}
            onZoomChange={setZoom}
            editable
            fit
            selectedId={selectedId}
            onSelect={onSelect}
            onLayerMove={onLayerMove}
            showPrintArea
          />
        </div>

        {pattern ? (
          <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-xl border border-white/15 bg-zinc-900/80 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl" role="toolbar" aria-label="Editor tools" aria-orientation="vertical">
            <RailButton icon={MousePointer2} label="Select and move" shortcut="V" active={tool === 'select'} onClick={() => setTool('select')} />
            <RailButton icon={Hand} label="Pan" shortcut="H" active={tool === 'hand'} onClick={() => setTool('hand')} />
            <span className="mx-auto my-0.5 h-px w-5 bg-white/15" aria-hidden="true" />
            <RailButton icon={Type} label={`Add text to ${SIDE_LABEL[side].toLowerCase()}`} onClick={art.addText} />
            <RailButton icon={art.uploading ? Loader2 : ImagePlus} label={`Add image to ${SIDE_LABEL[side].toLowerCase()}`} onClick={art.pickImages} />
          </div>
        ) : (
          <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-zinc-900/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 ring-1 ring-white/10">
            {SIDE_LABEL[side]}
          </span>
        )}
        <p className="pointer-events-none absolute right-3 top-3 hidden max-w-[15rem] text-right text-[11px] leading-snug text-zinc-500 lg:block">
          {pattern
            ? 'Click a piece to work on it, drag layers to move. Scroll to zoom, drag empty space to pan.'
            : 'Click a layer to select it, drag to move, arrow keys to nudge. Dashed box = printable area.'}
        </p>

        {/* Floating tools */}
        <div className="absolute inset-x-0 bottom-3 flex justify-center px-3">
          <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-white/15 bg-zinc-900/80 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl" role="toolbar" aria-label="Layer tools">
            {pattern && (
              <>
                <IconButton icon={Minus} label="Zoom out" onClick={() => preview.current?.zoomOut()} />
                <span className="w-11 shrink-0 text-center font-mono text-[11px] text-zinc-300" aria-live="polite">
                  {Math.round(zoom * 100)}%
                </span>
                <IconButton icon={Plus} label="Zoom in" onClick={() => preview.current?.zoomIn()} />
                <StudioButton variant="ghost" icon={Maximize} onClick={() => preview.current?.fit()} className="whitespace-nowrap px-2 py-1.5 text-xs">
                  Fit
                </StudioButton>
              </>
            )}
            {!pattern && (
              <>
                <StudioButton variant="ghost" icon={Type} onClick={art.addText} className="whitespace-nowrap px-2.5 py-1.5 text-xs">
                  Text
                </StudioButton>
                <StudioButton variant="ghost" icon={art.uploading ? Loader2 : ImagePlus} loading={Boolean(art.uploading)} onClick={art.pickImages} className="whitespace-nowrap px-2.5 py-1.5 text-xs">
                  {art.uploading ? `${art.uploading.progress}%` : 'Image'}
                </StudioButton>
              </>
            )}
            {selected && (
              <>
                <span className="mx-1 h-5 w-px shrink-0 bg-white/15" aria-hidden="true" />
                <IconButton icon={RotateCcw} label="Rotate left 15°" onClick={() => art.patchLayer(selected.id, { rotation: normRotation(rotation - 15) })} />
                <span className="w-9 shrink-0 text-center font-mono text-[11px] text-zinc-300">{rotation}°</span>
                <IconButton icon={RotateCw} label="Rotate right 15°" onClick={() => art.patchLayer(selected.id, { rotation: normRotation(rotation + 15) })} />
                <IconButton icon={Crosshair} label="Centre on this piece" onClick={() => art.patchLayer(selected.id, { x: 50, y: 50 })} />
                <IconButton icon={Trash2} label="Delete layer" onClick={() => art.remove(selected.id)} className="hover:!bg-red-500/10 hover:!text-red-300" />
              </>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Artwork tab: the layer stack of the current side (top of list = drawn on top) with add buttons. */
export function LayerList({ specs, side, selectedId, onSelect, art }) {
  const sideLayers = allLayersOf(specs).filter((l) => l.side === side);
  return (
    <Group title={`Layers · ${SIDE_LABEL[side]}`}>
      {sideLayers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-zinc-500">Nothing on this side yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {[...sideLayers].reverse().map((l) => (
            <li key={l.id}>
              <div
                className={cx(
                  'flex items-center gap-2.5 rounded-xl border px-2 py-1.5 transition',
                  l.id === selectedId ? 'border-brand-400/60 bg-brand-500/10' : 'border-transparent bg-zinc-950/40 hover:border-white/10'
                )}
              >
                <button type="button" onClick={() => onSelect(l.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <LayerThumb layer={l} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-100">{l.kind === 'image' ? 'Image' : l.text || '(empty text)'}</span>
                    <span className="block text-[11px] text-zinc-500">
                      {l.kind === 'image' ? `${Math.round(l.scale * 100)}% width` : `${l.font} · ${l.size}px`}
                      {l.rotation ? ` · ${l.rotation}°` : ''}
                    </span>
                  </span>
                </button>
                <IconButton icon={Trash2} label="Delete layer" onClick={() => art.remove(l.id)} className="hover:!bg-red-500/10 hover:!text-red-300" />
              </div>
            </li>
          ))}
        </ul>
      )}
      <AddButtons art={art} compact />
      <p className="text-[11px] text-zinc-500">
        PNG with a transparent background works best · max {MAX_MB} MB · up to {LIMITS.maxImages} images and {LIMITS.maxText} texts.
      </p>
    </Group>
  );
}

/**
 * RIGHT PANEL, "Artwork" tab: properties of the selected layer (content, size, colour, ROTATION, position).
 */
export function LayerInspector({ specs, selectedId, art, onSideChange }) {
  const layer = allLayersOf(specs).find((l) => l.id === selectedId);

  if (!layer) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center">
        <MousePointerClick className="mx-auto h-6 w-6 text-zinc-600" />
        <p className="mt-2 text-sm font-medium text-zinc-300">No layer selected</p>
        <p className="mt-1 text-xs text-zinc-500">Click a layer on the 2D editor or in the list above to edit it.</p>
      </div>
    );
  }

  const set = (patch, group) => art.patchLayer(layer.id, patch, group);
  const rotation = Number(layer.rotation) || 0;
  const rotateBy = (deg) => set({ rotation: normRotation(rotation + deg) });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <LayerThumb layer={layer} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{layer.kind === 'text' ? 'Text layer' : 'Image layer'}</p>
          <p className="text-xs text-zinc-500">On the {SIDE_LABEL[layer.side].toLowerCase()}</p>
        </div>
        <StudioButton variant="danger" icon={Trash2} onClick={() => art.remove(layer.id)} className="px-2">
          Delete
        </StudioButton>
      </div>

      {layer.kind === 'text' && (
        <>
          <Group title="Text">
            <input
              value={layer.text}
              maxLength={LIMITS.textMax}
              onChange={(e) => set({ text: e.target.value }, 'text')}
              className={cx(studioInput, !layer.text.trim() && 'border-red-400/60')}
              aria-label="Layer text"
            />
            <p className={cx('text-[11px]', layer.text.trim() ? 'text-zinc-500' : 'text-red-300')}>
              {layer.text.trim() ? `${layer.text.length}/${LIMITS.textMax} characters` : 'Enter some text or delete this layer'}
            </p>
          </Group>
          <Group title="Font">
            <div className="grid grid-cols-2 gap-1.5">
              {FONTS.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => set({ font: f.name })}
                  title={f.label}
                  className={cx(
                    'truncate rounded-lg border px-3 py-2 text-left text-base transition',
                    layer.font === f.name ? 'border-brand-400/70 bg-brand-500/10 text-white' : 'border-white/[0.07] bg-zinc-950/40 text-zinc-300 hover:border-white/15'
                  )}
                  style={{ fontFamily: fontFamily(f.name), fontWeight: f.weight }}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </Group>
          <Slider id="layer-size" label="Font size" value={layer.size} display={`${layer.size}px`} min={LIMITS.sizeMin} max={LIMITS.sizeMax} onChange={(v) => set({ size: v }, 'size')} />
          <Group title="Ink / thread colour">
            <div className="flex flex-wrap items-center gap-2">
              {TEXT_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Text colour ${hex}`}
                  onClick={() => set({ color: hex })}
                  className={cx('h-7 w-7 rounded-full ring-1 ring-white/20 transition hover:scale-110', layer.color.toUpperCase() === hex && 'ring-2 ring-brand-400 ring-offset-2 ring-offset-zinc-900')}
                  style={{ backgroundColor: hex }}
                />
              ))}
              <input
                type="color"
                value={layer.color}
                onChange={(e) => set({ color: e.target.value.toUpperCase() }, 'color')}
                className="h-7 w-9 cursor-pointer rounded-md border border-white/10 bg-zinc-950 p-0.5"
                aria-label="Custom text colour"
              />
            </div>
          </Group>
        </>
      )}

      {layer.kind === 'image' && (
        <Slider
          id="layer-scale"
          label="Image size"
          value={layer.scale}
          display={`${Math.round(layer.scale * 100)}%`}
          min={LIMITS.scaleMin}
          max={LIMITS.scaleMax}
          step={0.01}
          onChange={(v) => set({ scale: v }, 'scale')}
        />
      )}

      <Group title="Rotation" action={<span className="text-[11px] text-zinc-500">around the layer centre</span>}>
        <Slider
          id="layer-rotation"
          label="Angle"
          value={rotation}
          display={`${rotation}°`}
          min={LIMITS.rotationMin}
          max={LIMITS.rotationMax}
          onChange={(v) => set({ rotation: v }, 'rotation')}
          onReset={rotation ? () => set({ rotation: 0 }) : undefined}
        />
        <div className="grid grid-cols-4 gap-1.5">
          <StudioButton icon={RotateCcw} onClick={() => rotateBy(-15)} className="px-2 text-xs">
            15°
          </StudioButton>
          <StudioButton onClick={() => set({ rotation: normRotation(rotation - 90) })} className="px-2 text-xs">
            −90°
          </StudioButton>
          <StudioButton onClick={() => set({ rotation: normRotation(rotation + 90) })} className="px-2 text-xs">
            +90°
          </StudioButton>
          <StudioButton icon={RotateCw} onClick={() => rotateBy(15)} className="px-2 text-xs">
            15°
          </StudioButton>
        </div>
      </Group>

      <Group
        title="Position"
        action={
          <button type="button" onClick={() => set({ x: 50, y: 50 })} className="flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200">
            <Crosshair className="h-3.5 w-3.5" /> Centre
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          {['x', 'y'].map((axis) => (
            <div key={axis} className="flex items-center justify-between rounded-lg bg-zinc-950/60 px-2.5 py-1.5 ring-1 ring-white/[0.06]">
              <span className="uppercase text-zinc-500">{axis}</span>
              <span className="text-zinc-200">{layer[axis]}%</span>
            </div>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-400">Move to side</span>
          <select
            value={layer.side}
            onChange={(e) => {
              art.moveToSide(layer, e.target.value);
              onSideChange(e.target.value);
            }}
            className={studioInput}
          >
            {SIDES.map((s) => (
              <option key={s} value={s}>
                {SIDE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </Group>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> undo · <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd> redo · arrow keys nudge (<Kbd>Shift</Kbd> = 5%)
      </p>
    </div>
  );
}
