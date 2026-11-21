import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PHOTO_SIZE, photoLayerBoxes, photoPlacement, photoToLayer, renderPhotoMockup } from '../../utils/photoMockup';

/**
 * Photo preview of one side of the design on a realistic, recoloured garment photo (see utils/photoMockup.js).
 *
 * interactive: click a print to select it, drag it to move it (positions are converted back to the print area,
 * so the 2D editor, 3D view and print files all follow), click the shirt or background to deselect.
 */
export default function PhotoMockupView({ specs, face = 'front', className = '', label, interactive = false, selectedId = null, onSelect, onLayerMove }) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const drag = useRef(null);
  const [state, setState] = useState('loading');
  const [boxes, setBoxes] = useState([]);
  const [dragging, setDragging] = useState(false);

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
    overlayRef.current?.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };
  const moveDrag = (event) => {
    if (!drag.current) return;
    const p = toPhoto(event);
    if (!p) return;
    const { id, dx, dy, place } = drag.current;
    onLayerMove(id, photoToLayer(place, p.x - dx, p.y - dy));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return (
    <div className={className}>
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
          <svg
            ref={overlayRef}
            viewBox={`0 0 ${PHOTO_SIZE.width} ${PHOTO_SIZE.height}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 h-full w-full select-none"
            style={{ touchAction: 'none' }}
            onPointerDown={() => onSelect?.(null)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-hidden="true"
          >
            {boxes.map((b) => {
              const selected = b.id === selectedId;
              return (
                <g key={b.id} transform={`rotate(${b.rotation} ${b.px} ${b.py})`} onPointerDown={(e) => startDrag(b, e)} style={{ cursor: dragging ? 'grabbing' : 'grab' }} data-photo-layer={b.id}>
                  <rect x={b.px - b.w / 2 - 6} y={b.py - b.h / 2 - 6} width={b.w + 12} height={b.h + 12} fill="transparent" />
                  {selected && (
                    <rect x={b.px - b.w / 2 - 6} y={b.py - b.h / 2 - 6} width={b.w + 12} height={b.h + 12} rx="6" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeDasharray="7 5" />
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {state === 'loading' && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </span>
        )}
        {state === 'error' && <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-500">Photo preview unavailable.</span>}
      </div>
    </div>
  );
}
