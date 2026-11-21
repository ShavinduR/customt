import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BODY, PRINT_AREAS, SIDES, SIDE_FACE, VIEW_H, VIEW_W, detailsFor, shade } from '../../utils/garmentGeometry';
import { FONT_WIDTH, fontFamily, fontWeight, layersOf } from '../../utils/design';
import { patternLayout, toSvgMatrix } from '../../utils/patternLayout';
import { formatSize } from '../../utils/units';

/**
 * Layered SVG garment renderer, used by the design studio (editable) and by order/auction pages (read-only).
 * Layers: base colour → fabric texture → construction details → lighting → artwork layers.
 *
 * mode "garment" (default): one view of the garment.
 *   view: 'front' | 'back' | 'leftSleeve' | 'rightSleeve'. Sleeve views zoom in on that sleeve and rotate it
 *   level. Sleeve prints sit on the front face of the garment, so they also show in the front view.
 * mode "pattern": the garment cut into flat pieces (front, back, two unfolded sleeves), see patternLayout.js.
 *   Every piece is drawn from the same face artwork, so what you place on a piece is exactly what the 3D
 *   model shows. Supports zoom (wheel, or the imperative zoomIn/zoomOut/fit) and panning.
 */

const SLEEVE_VIEW = { w: 140, h: 161 };
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;
const clampPct = (v) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

const areaTransform = (a) => `translate(${a.cx} ${a.cy}) rotate(${a.rotate}) translate(${-a.w / 2} ${-a.h / 2})`;

const TShirtPreview = forwardRef(function TShirtPreview(
  {
    specs,
    view = 'front',
    editable = false,
    selectedId = null,
    onSelect,
    onLayerMove,
    className = '',
    showPrintArea = false,
    fit = false,
    mode = 'garment',
    activeSide = 'front',
    onPieceSelect,
    tool = 'select',
    onZoomChange,
    units = 'cm',
    onViewport,
  },
  ref
) {
  const uid = useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const areaRefs = useRef({});
  const drag = useRef(null);
  const pan = useRef(null);
  const pieceHit = useRef(false);
  const zoomGroup = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [panning, setPanning] = useState(false);
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 });

  const pattern = mode === 'pattern';
  const garment = BODY[specs.garmentType] ? specs.garmentType : 'Crew Neck';
  const color = specs.color || '#FFFFFF';
  const face = SIDE_FACE[view] || 'front';
  const areas = PRINT_AREAS[garment];
  const sleeveView = !pattern && (view === 'leftSleeve' || view === 'rightSleeve');
  const { textLayers, imageLayers } = useMemo(() => layersOf(specs), [specs]);
  const allLayers = useMemo(() => [...imageLayers.map((l) => ({ ...l, kind: 'image' })), ...textLayers.map((l) => ({ ...l, kind: 'text' }))], [textLayers, imageLayers]);
  const fabricPattern = specs.fabric === 'Pique/Crocodile' ? 'pique' : specs.fabric === 'Dry-Fit/Wetlook' ? 'mesh' : 'cotton';
  const printType = specs.printType || 'Screen Printing';
  const layout = useMemo(() => (pattern ? patternLayout(garment) : null), [pattern, garment]);

  const active = areas[view] || areas.front;
  const viewBox = pattern
    ? `0 0 ${layout.width} ${layout.height}`
    : sleeveView
      ? `${active.cx - SLEEVE_VIEW.w / 2} ${active.cy - SLEEVE_VIEW.h / 2} ${SLEEVE_VIEW.w} ${SLEEVE_VIEW.h}`
      : `0 0 ${VIEW_W} ${VIEW_H}`;
  const viewTransform = sleeveView ? `rotate(${-active.rotate} ${active.cx} ${active.cy})` : undefined;
  // In pattern mode any layer can be dragged (all pieces are on screen); in garment mode only the shown side.
  const canEdit = (layer) => editable && (pattern || layer.side === view);

  // ── Zoom & pan (pattern mode) ──
  const toSvgRoot = (clientX, clientY) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return null;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    return p.matrixTransform(ctm.inverse());
  };
  const zoomAt = useCallback((factor, at) => {
    setZoom((z) => {
      const s = clampZoom(z.s * factor);
      if (s === z.s) return z;
      const cx = at?.x ?? (layout ? layout.width / 2 : 0);
      const cy = at?.y ?? (layout ? layout.height / 2 : 0);
      // Keep the point under the cursor fixed: view = s·content + t.
      return { s, x: cx - (s * (cx - z.x)) / z.s, y: cy - (s * (cy - z.y)) / z.s };
    });
  }, [layout]);

  useImperativeHandle(ref, () => ({ zoomIn: () => zoomAt(1.25), zoomOut: () => zoomAt(0.8), fit: () => setZoom({ s: 1, x: 0, y: 0 }) }), [zoomAt]);
  useEffect(() => onZoomChange?.(zoom.s), [zoom.s, onZoomChange]);
  useEffect(() => setZoom({ s: 1, x: 0, y: 0 }), [garment, pattern]);

  // Reports how layout units map to screen pixels (for the rulers): screenX = x + k·u, screenY = y + k·v.
  const lastViewport = useRef('');
  const reportViewport = useCallback(() => {
    const ctm = zoomGroup.current?.getScreenCTM();
    if (!ctm || !layout || !onViewport) return;
    const key = `${ctm.a.toFixed(4)}|${ctm.e.toFixed(1)}|${ctm.f.toFixed(1)}|${layout.garment}`;
    if (key === lastViewport.current) return; // only report real changes (the parent re-renders on each report)
    lastViewport.current = key;
    onViewport({ k: ctm.a, x: ctm.e, y: ctm.f, origin: layout.origin });
  }, [onViewport, layout]);
  useLayoutEffect(() => {
    if (pattern) reportViewport();
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!pattern || !svg || !onViewport) return undefined;
    const ro = new ResizeObserver(reportViewport);
    ro.observe(svg);
    window.addEventListener('scroll', reportViewport, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', reportViewport, true);
    };
  }, [pattern, onViewport, reportViewport]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!pattern || !svg) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0015), toSvgRoot(e.clientX, e.clientY));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [pattern, zoomAt]);

  // ── Layer dragging ──
  const toArea = (side, event) => {
    const group = areaRefs.current[side];
    const svg = svgRef.current;
    const ctm = group?.getScreenCTM();
    if (!svg || !ctm) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(ctm.inverse());
  };

  const startDrag = (layer, event) => {
    if (!editable || (pattern && tool === 'hand')) return;
    event.stopPropagation();
    onSelect?.(layer.id);
    if (!canEdit(layer) || !onLayerMove) return;
    event.preventDefault();
    const area = areas[layer.side];
    const p = toArea(layer.side, event);
    if (!p) return;
    drag.current = { id: layer.id, side: layer.side, dx: p.x - (layer.x / 100) * area.w, dy: p.y - (layer.y / 100) * area.h };
    svgRef.current?.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const onPointerDown = (event) => {
    if (!editable) return;
    const hitPiece = pieceHit.current;
    pieceHit.current = false;
    if (!pattern) {
      onSelect?.(null);
      return;
    }
    // Hand tool, middle button, or empty space between the pieces: pan. A click on a piece selects it.
    if (tool === 'hand' || event.button === 1 || !hitPiece) {
      if (!hitPiece && tool !== 'hand') onSelect?.(null);
      const p = toSvgRoot(event.clientX, event.clientY);
      if (!p) return;
      event.preventDefault();
      pan.current = { x: p.x, y: p.y, start: zoom };
      svgRef.current?.setPointerCapture?.(event.pointerId);
      setPanning(true);
    } else onSelect?.(null);
  };

  const onPointerMove = (event) => {
    if (pan.current) {
      const p = toSvgRoot(event.clientX, event.clientY);
      if (!p) return;
      const { start } = pan.current;
      setZoom({ s: start.s, x: start.x + (p.x - pan.current.x), y: start.y + (p.y - pan.current.y) });
      return;
    }
    if (!drag.current) return;
    const { id, side, dx, dy } = drag.current;
    const area = areas[side];
    const p = toArea(side, event);
    if (!p) return;
    onLayerMove(id, { x: clampPct(((p.x - dx) / area.w) * 100), y: clampPct(((p.y - dy) / area.h) * 100) });
  };

  const endDrag = () => {
    drag.current = null;
    pan.current = null;
    setDragging(false);
    setPanning(false);
  };

  const onKeyDown = (event) => {
    if (!editable || !onLayerMove) return;
    const layer = allLayers.find((l) => l.id === selectedId && canEdit(l));
    const step = event.shiftKey ? 5 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!layer || !delta) return;
    event.preventDefault();
    onLayerMove(layer.id, { x: clampPct(layer.x + delta[0]), y: clampPct(layer.y + delta[1]) });
  };

  const textEffect = {
    DTF: { filter: `url(#gloss-${uid})` },
    Embroidery: { filter: `url(#stitch-${uid})`, stitched: true },
    Sublimation: { opacity: 0.88 },
  }[printType] || {};

  const thin = sleeveView ? 0.6 : 1.2;

  const renderLayer = (layer, area) => {
    const cx = (layer.x / 100) * area.w;
    const cy = (layer.y / 100) * area.h;
    const interactive = canEdit(layer);
    const selected = editable && layer.id === selectedId;
    let box;
    let content;
    if (layer.kind === 'image') {
      const size = layer.scale * area.w;
      box = { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
      // No crossOrigin here on purpose: the 2D view must show the image even if a cached copy lacks CORS headers.
      // The 3D painter needs CORS and retries with a fresh copy itself (utils/designTexture.js).
      content = <image href={layer.url} x={box.x} y={box.y} width={size} height={size} preserveAspectRatio="xMidYMid meet" />;
    } else {
      const width = Math.max(8, layer.size * (FONT_WIDTH[layer.font] || 0.6) * layer.text.length);
      box = { x: cx - width / 2, y: cy - layer.size * 0.62, w: width, h: layer.size * 1.24 };
      content = (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={fontFamily(layer.font)}
          fontWeight={fontWeight(layer.font)}
          fontSize={layer.size}
          fill={layer.color}
          stroke={textEffect.stitched ? shade(layer.color, -35) : undefined}
          strokeWidth={textEffect.stitched ? Math.max(0.4, layer.size / 30) : undefined}
          strokeDasharray={textEffect.stitched ? '2.2 1.4' : undefined}
        >
          {layer.text}
        </text>
      );
    }
    const rotation = Number(layer.rotation) || 0;
    return (
      <g
        key={layer.id}
        data-layer={layer.id}
        transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}
        onPointerDown={editable ? (e) => startDrag(layer, e) : undefined}
        style={{ cursor: interactive && tool !== 'hand' ? (dragging ? 'grabbing' : 'grab') : editable ? 'pointer' : 'default', opacity: textEffect.opacity }}
        filter={layer.kind === 'text' ? textEffect.filter : undefined}
      >
        {content}
        {interactive && <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="transparent" />}
        {selected && <rect x={box.x - 2} y={box.y - 2} width={box.w + 4} height={box.h + 4} rx="2" fill="none" stroke="#6366f1" strokeWidth={thin} strokeDasharray="4 3" />}
      </g>
    );
  };

  /**
   * One face of the garment (fabric, details, artwork). `ownedSides` are the print areas whose group is used
   * for drag maths; in pattern mode each side is owned by exactly one piece (the others are clipped copies).
   */
  const renderFace = (f, { ownedSides, flat = false }) => {
    const sidesOnFace = SIDES.filter((s) => SIDE_FACE[s] === f);
    return (
      <>
        <path d={BODY[garment]} fill={color} />
        <path d={BODY[garment]} fill={`url(#${fabricPattern}-${uid})`} />
        {detailsFor(garment, f).map((d, i) => (
          <path
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            d={d.d}
            fill={d.fill !== undefined ? shade(color, d.fill) : 'none'}
            stroke={d.stroke !== undefined ? shade(color, d.stroke) : undefined}
            strokeWidth={d.width}
            strokeDasharray={d.dash?.join(' ')}
            strokeLinecap={d.cap}
            strokeLinejoin={d.join}
          />
        ))}
        {!flat && <path d={BODY[garment]} fill={`url(#light-${uid})`} />}
        {!flat && <path d={BODY[garment]} fill={`url(#fold-${uid})`} />}
        <path d={BODY[garment]} fill="none" stroke={shade(color, -38)} strokeWidth={sleeveView ? 0.8 : 1.6} strokeLinejoin="round" />

        <g clipPath={`url(#body-${uid})`}>
          {sidesOnFace.map((side) => {
            const area = areas[side];
            const owned = ownedSides.includes(side);
            const showArea = editable && owned && (pattern ? side === activeSide || dragging : side === view && (showPrintArea || dragging));
            return (
              <g
                key={side}
                ref={
                  owned
                    ? (el) => {
                        areaRefs.current[side] = el;
                      }
                    : undefined
                }
                transform={areaTransform(area)}
              >
                {showArea && <rect x="0" y="0" width={area.w} height={area.h} rx="4" fill="none" stroke="#6366f1" strokeWidth={thin} strokeDasharray="5 4" opacity="0.7" />}
                {allLayers.filter((l) => l.side === side).map((l) => renderLayer(l, area))}
              </g>
            );
          })}
        </g>
      </>
    );
  };

  const renderPattern = () => (
    <g ref={zoomGroup} transform={`translate(${zoom.x} ${zoom.y}) scale(${zoom.s})`}>
      {layout.pieces.map((piece) => {
        const isActive = editable && piece.side === activeSide;
        return (
          <g
            key={piece.side}
            data-piece={piece.side}
            onPointerDown={
              editable
                ? () => {
                    pieceHit.current = true;
                    if (tool !== 'hand') onPieceSelect?.(piece.side);
                  }
                : undefined
            }
            style={{ cursor: tool === 'hand' ? undefined : 'pointer' }}
          >
            {piece.halves.map((half) => (
              <g key={`${half.face}-${half.region}`} transform={toSvgMatrix(half.m)}>
                <g clipPath={`url(#rg-${half.region}-${uid})`}>
                  {renderFace(half.face, { ownedSides: half.owns ? [piece.side] : [], flat: true })}
                  {/* Cut line along the armhole seam (half of the stroke falls inside this piece). */}
                  {/* Clipped to the garment: below the armpit the seam runs outside a sleeve piece. */}
                  <g clipPath={`url(#body-${uid})`}>
                    <path d={layout.regions.cutLines[half.region]} fill="none" stroke={isActive ? '#818cf8' : shade(color, -38)} strokeWidth={isActive ? 4 : 3.2} />
                  </g>
                  {isActive && <path d={BODY[garment]} fill="none" stroke="#818cf8" strokeWidth="4" strokeLinejoin="round" />}
                </g>
              </g>
            ))}
            {/* Fold / centre line */}
            <line x1={piece.foldX} x2={piece.foldX} y1={piece.rect.y + 2} y2={piece.rect.y + piece.rect.h - 2} stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="5 5" pointerEvents="none" />
            <text x={piece.rect.x + piece.rect.w / 2} y={piece.rect.y + piece.rect.h + 22} textAnchor="middle" fontSize="13" fontWeight="600" fill={isActive ? '#c7d2fe' : '#d4d4d8'} fontFamily="Inter, sans-serif" pointerEvents="none">
              {piece.label}
            </text>
            <text x={piece.rect.x + piece.rect.w / 2} y={piece.rect.y + piece.rect.h + 36} textAnchor="middle" fontSize="10" fill="#71717a" fontFamily="Inter, sans-serif" pointerEvents="none">
              {formatSize(piece.rect.w, piece.rect.h, units)} · cut 1
            </text>
          </g>
        );
      })}
    </g>
  );

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      className={`${fit ? 'h-full w-full' : 'h-auto w-full'} select-none ${className}`}
      role="img"
      aria-label={pattern ? `${specs.garmentType || 'T-shirt'} sewing pattern: front, back and both sleeves` : `${specs.garmentType || 'T-shirt'} preview, ${view} view`}
      tabIndex={editable ? 0 : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ touchAction: editable ? 'none' : undefined, outline: 'none', cursor: pattern && (tool === 'hand' || panning) ? (panning ? 'grabbing' : 'grab') : undefined }}
    >
      <defs>
        <clipPath id={`body-${uid}`}>
          <path d={BODY[garment]} />
        </clipPath>
        {pattern &&
          Object.entries(layout.regions.paths).map(([region, d]) => (
            <clipPath key={region} id={`rg-${region}-${uid}`}>
              <path d={d} />
            </clipPath>
          ))}
        <linearGradient id={`light-${uid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.22" />
          <stop offset="0.2" stopColor="#000" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="0.8" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.24" />
        </linearGradient>
        <linearGradient id={`fold-${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="0.85" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.14" />
        </linearGradient>
        <pattern id={`cotton-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#000" strokeOpacity="0.05" strokeWidth="1.4" />
        </pattern>
        <pattern id={`pique-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.15" fill="#000" fillOpacity="0.09" />
          <circle cx="0" cy="0" r="0.8" fill="#fff" fillOpacity="0.08" />
        </pattern>
        <pattern id={`mesh-${uid}`} width="7" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1.75" cy="1.5" r="1.05" fill="#000" fillOpacity="0.11" />
          <circle cx="5.25" cy="4.5" r="1.05" fill="#000" fillOpacity="0.11" />
        </pattern>
        <filter id={`gloss-${uid}`} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="0.8" stdDeviation="0.5" floodColor="#000" floodOpacity="0.3" />
        </filter>
        <filter id={`stitch-${uid}`} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="1.3" stdDeviation="0.45" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>

      {pattern ? (
        <>
          {/* Transparent backdrop so empty space receives pointer events (pan / deselect). */}
          <rect x="0" y="0" width={layout.width} height={layout.height} fill="transparent" />
          {renderPattern()}
        </>
      ) : (
        <>
          <g transform={viewTransform}>
            {!sleeveView && <ellipse cx={VIEW_W / 2} cy="446" rx="190" ry="8" fill="#0f172a" opacity="0.08" />}
            {renderFace(face, { ownedSides: SIDES.filter((s) => SIDE_FACE[s] === face) })}
          </g>
          {!sleeveView && (
            <text x={VIEW_W / 2} y="458" textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="Inter, sans-serif" letterSpacing="2">
              {face.toUpperCase()}
            </text>
          )}
        </>
      )}
    </svg>
  );
});

export default TShirtPreview;
