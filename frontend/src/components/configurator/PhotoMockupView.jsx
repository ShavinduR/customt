import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Maximize, Minus, Plus } from 'lucide-react';
import { PHOTO_SIZE, photoLayerBoxes, photoPlacement, photoToLayer, renderPhotoMockup } from '../../utils/photoMockup';

const ZOOM_MAX = 3; // the garment photos are 800 × 900 px, so closer than ~3× only shows blur
const DOUBLE_TAP_ZOOM = 2.5;
const TAP_SLOP = 6; // px a pointer may move and still count as a tap (deselect) rather than a pan

/**
 * Photo preview of one side of the design on a realistic, recoloured garment photo (see utils/photoMockup.js).
 *
 * interactive: click a print to select it, drag it to move it (positions are converted back to the print area,
 * so the 2D editor, 3D view and print files all follow), click the shirt or background to deselect.
 * zoomable: wheel / pinch / double-click zoom up to 3×, drag the empty area to pan, − + Fit buttons.
 */
export default function PhotoMockupView({ specs, face = 'front', className = '', label, interactive = false, zoomable = false, selectedId = null, onSelect, onLayerMove }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const [state, setState] = useState('loading');
  const [boxes, setBoxes] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 });

  // Render: immediately while dragging (only the print is redrawn; the recoloured shirt is cached), else debounced.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        try {
          const rendered = await renderPhotoMockup(specs, face);
          if (cancelled || !canvasRef.current) return;
          const ctx = canvasRef.current.getContext('2d');
          ctx.clearRect(0, 0, PHOTO_SIZE.width, PHOTO_SIZE.height);
          ctx.drawImage(rendered, 0, 0);
          setState('ready');
        } catch {
          if (!cancelled) setState('error');
        }
      },
      dragging ? 0 : 120
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [specs, face, dragging]);

  useEffect(() => {
    if (!interactive) return undefined;
    let cancelled = false;
    photoLayerBoxes(specs, face).then((b) => !cancelled && setBoxes(b)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [interactive, specs, face]);

  // ── Zoom & pan (CSS transform of the picture; hit-testing follows because getScreenCTM includes it) ──
  useEffect(() => setZoom({ s: 1, x: 0, y: 0 }), [face, specs.garmentType]);

  /** Keeps the zoomed picture covering the frame (no empty gaps at the edges). */
  const clampZoom = useCallback((z) => {
    const el = wrapRef.current;
    if (!el) return z;
    const s = Math.max(1, Math.min(ZOOM_MAX, z.s));
    const { width: w, height: h } = el.getBoundingClientRect();
    return { s, x: Math.min(0, Math.max(w * (1 - s), z.x)), y: Math.min(0, Math.max(h * (1 - s), z.y)) };
  }, []);

  /** Zoom by `factor` around a point given in frame coordinates (px from the frame's top-left). */
  const zoomAt = useCallback(
    (factor, at) => {
      setZoom((z) => {
        const el = wrapRef.current;
        if (!el) return z;
        const { width: w, height: h } = el.getBoundingClientRect();
        const cx = at?.x ?? w / 2;
        const cy = at?.y ?? h / 2;
        const s = Math.max(1, Math.min(ZOOM_MAX, z.s * factor));
        return clampZoom({ s, x: cx - ((cx - z.x) * s) / z.s, y: cy - ((cy - z.y) * s) / z.s });
      });
    },
    [clampZoom]
  );

  const framePoint = (event) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!zoomable || !el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomable, zoomAt]);

  // Pointers on the frame: one finger/mouse pans (when zoomed) or taps to deselect; two fingers pinch.
  const onFrameDown = (event) => {
    if (!zoomable && !interactive) return;
    wrapRef.current.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, framePoint(event));
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && zoomable) {
      gesture.current = { type: 'pinch', dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), moved: true };
    } else if (pts.length === 1) {
      gesture.current = { type: 'pan', start: pts[0], last: pts[0], moved: false };
    }
  };
  const onFrameMove = (event) => {
    if (drag.current) return moveDrag(event);
    if (!pointers.current.has(event.pointerId) || !gesture.current) return undefined;
    const p = framePoint(event);
    pointers.current.set(event.pointerId, p);
    const g = gesture.current;
    if (g.type === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return undefined;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      zoomAt(dist / g.dist, { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });
      g.dist = dist;
    } else {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > TAP_SLOP) g.moved = true;
      // Capture this step's movement now: the state updater may run later, after g.last has moved on.
      const dx = p.x - g.last.x;
      const dy = p.y - g.last.y;
      if (g.moved && zoomable) setZoom((z) => (z.s > 1 ? clampZoom({ ...z, x: z.x + dx, y: z.y + dy }) : z));
      g.last = p;
    }
    return undefined;
  };
  const onFrameUp = (event) => {
    if (drag.current) {
      endDrag();
      return;
    }
    const g = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      if (g?.type === 'pan' && !g.moved && interactive) onSelect?.(null); // a tap on the shirt or background
      gesture.current = null;
    } else if (pointers.current.size === 1) {
      const [rest] = pointers.current.values();
      gesture.current = { type: 'pan', start: rest, last: rest, moved: true };
    }
  };

  // ── Layer dragging ──
  /** Pointer position in photo pixels (the overlay uses the same 800 × 900 viewBox as the canvas). */
  const toPhoto = (event) => {
    const svg = overlayRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return null;
    const p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    return p.matrixTransform(ctm.inverse());
  };
  const startDrag = (box, event) => {
    event.stopPropagation();
    onSelect?.(box.id);
    if (!onLayerMove) return;
    const p = toPhoto(event);
    if (!p) return;
    event.preventDefault();
    drag.current = { id: box.id, dx: p.x - box.px, dy: p.y - box.py, place: photoPlacement(specs, face) };
    wrapRef.current?.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };
  function moveDrag(event) {
    const p = toPhoto(event);
    if (!p) return;
    const { id, dx, dy, place } = drag.current;
    onLayerMove(id, photoToLayer(place, p.x - dx, p.y - dy));
  }
  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  const zoomed = zoom.s > 1.001;

  return (
    <div className={className}>
      <div
        ref={wrapRef}
        className="relative h-full w-full overflow-hidden"
        style={{ touchAction: zoomable || interactive ? 'none' : undefined, cursor: zoomable && zoomed && !dragging ? 'grab' : undefined }}
        onPointerDown={onFrameDown}
        onPointerMove={onFrameMove}
        onPointerUp={onFrameUp}
        onPointerCancel={onFrameUp}
        onDoubleClick={zoomable ? (e) => (zoomed ? setZoom({ s: 1, x: 0, y: 0 }) : zoomAt(DOUBLE_TAP_ZOOM, framePoint(e))) : undefined}
      >
        <div className="h-full w-full origin-top-left" style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` }}>
          <div className="relative h-full w-full">
            <canvas
              ref={canvasRef}
              width={PHOTO_SIZE.width}
              height={PHOTO_SIZE.height}
              role="img"
              aria-label={label || `Photo preview of the ${specs.garmentType || 'garment'}, ${face}`}
              className={`h-full w-full object-contain transition-opacity duration-300 ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
            />
            {interactive && state === 'ready' && (
              <svg ref={overlayRef} viewBox={`0 0 ${PHOTO_SIZE.width} ${PHOTO_SIZE.height}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full select-none" aria-hidden="true">
                {boxes.map((b) => {
                  const selected = b.id === selectedId;
                  return (
                    <g key={b.id} transform={`rotate(${b.rotation} ${b.px} ${b.py})`} onPointerDown={(e) => startDrag(b, e)} style={{ cursor: dragging ? 'grabbing' : 'grab' }} data-photo-layer={b.id}>
                      <rect x={b.px - b.w / 2 - 6} y={b.py - b.h / 2 - 6} width={b.w + 12} height={b.h + 12} fill="transparent" />
                      {selected && (
                        <rect
                          x={b.px - b.w / 2 - 6}
                          y={b.py - b.h / 2 - 6}
                          width={b.w + 12}
                          height={b.h + 12}
                          rx="6"
                          fill="none"
                          stroke="#818cf8"
                          strokeWidth={2.5 / zoom.s}
                          strokeDasharray={`${7 / zoom.s} ${5 / zoom.s}`}
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>
        {state === 'loading' && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </span>
        )}
        {state === 'error' && <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-500">Photo preview unavailable.</span>}
      </div>
      {zoomable && state === 'ready' && (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-xl border border-white/15 bg-zinc-900/80 p-1 text-zinc-200 shadow-xl backdrop-blur-xl" role="toolbar" aria-label="Photo zoom">
          <button type="button" onClick={() => zoomAt(1 / 1.4)} disabled={!zoomed} aria-label="Zoom out of photo" className="rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-35">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center font-mono text-[11px]" aria-live="polite">
            {Math.round(zoom.s * 100)}%
          </span>
          <button type="button" onClick={() => zoomAt(1.4)} disabled={zoom.s >= ZOOM_MAX - 0.001} aria-label="Zoom in on photo" className="rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-35">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setZoom({ s: 1, x: 0, y: 0 })} disabled={!zoomed} aria-label="Fit photo" title="Fit" className="rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-35">
            <Maximize className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
