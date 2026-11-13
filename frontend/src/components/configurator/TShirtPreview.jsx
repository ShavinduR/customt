import { useId, useMemo, useRef, useState } from 'react';
import { BODY, PRINT_AREAS, SIDES, SIDE_FACE, VIEW_H, VIEW_W, detailsFor, shade } from '../../utils/garmentGeometry';
import { fontFamily, fontWeight, layersOf } from '../../utils/design';

/**
 * Layered SVG garment renderer, used by the configurator (editable) and by order/auction pages (read-only).
 * Layers: base colour → fabric texture → construction details → lighting → artwork layers.
 *
 * view: 'front' | 'back' | 'leftSleeve' | 'rightSleeve'. Sleeve views zoom in on that sleeve and rotate it
 * level. Sleeve prints sit on the front face of the garment, so they also show in the front view.
 */

const SLEEVE_VIEW = { w: 140, h: 161 };
const FONT_WIDTH = { 'Bebas Neue': 0.45, Montserrat: 0.74, 'Playfair Display': 0.6, Pacifico: 0.58 };
const clampPct = (v) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));

const areaTransform = (a) => `translate(${a.cx} ${a.cy}) rotate(${a.rotate}) translate(${-a.w / 2} ${-a.h / 2})`;

export default function TShirtPreview({ specs, view = 'front', editable = false, selectedId = null, onSelect, onLayerMove, className = '', showPrintArea = false }) {
  const uid = useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const areaRefs = useRef({});
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);

  const garment = BODY[specs.garmentType] ? specs.garmentType : 'Crew Neck';
  const color = specs.color || '#FFFFFF';
  const face = SIDE_FACE[view] || 'front';
  const areas = PRINT_AREAS[garment];
  const sleeveView = view === 'leftSleeve' || view === 'rightSleeve';
  const { textLayers, imageLayers } = useMemo(() => layersOf(specs), [specs]);
  const allLayers = useMemo(() => [...imageLayers.map((l) => ({ ...l, kind: 'image' })), ...textLayers.map((l) => ({ ...l, kind: 'text' }))], [textLayers, imageLayers]);
  const fabricPattern = specs.fabric === 'Pique/Crocodile' ? 'pique' : specs.fabric === 'Dry-Fit/Wetlook' ? 'mesh' : 'cotton';
  const printType = specs.printType || 'Screen Printing';

  const active = areas[view] || areas.front;
  const viewBox = sleeveView ? `${active.cx - SLEEVE_VIEW.w / 2} ${active.cy - SLEEVE_VIEW.h / 2} ${SLEEVE_VIEW.w} ${SLEEVE_VIEW.h}` : `0 0 ${VIEW_W} ${VIEW_H}`;
  const viewTransform = sleeveView ? `rotate(${-active.rotate} ${active.cx} ${active.cy})` : undefined;

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
    if (!editable) return;
    event.stopPropagation();
    onSelect?.(layer.id);
    if (layer.side !== view || !onLayerMove) return;
    event.preventDefault();
    const area = areas[layer.side];
    const p = toArea(layer.side, event);
    if (!p) return;
    drag.current = { id: layer.id, side: layer.side, dx: p.x - (layer.x / 100) * area.w, dy: p.y - (layer.y / 100) * area.h };
    svgRef.current?.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const moveDrag = (event) => {
    if (!drag.current) return;
    const { id, side, dx, dy } = drag.current;
    const area = areas[side];
    const p = toArea(side, event);
    if (!p) return;
    onLayerMove(id, { x: clampPct(((p.x - dx) / area.w) * 100), y: clampPct(((p.y - dy) / area.h) * 100) });
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (event) => {
    if (!editable || !onLayerMove) return;
    const layer = allLayers.find((l) => l.id === selectedId && l.side === view);
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

  const renderLayer = (layer, area) => {
    const cx = (layer.x / 100) * area.w;
    const cy = (layer.y / 100) * area.h;
    const interactive = editable && layer.side === view;
    const selected = editable && layer.id === selectedId;
    let box;
    let content;
    if (layer.kind === 'image') {
      const size = layer.scale * area.w;
      box = { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
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
    return (
      <g
        key={layer.id}
        data-layer={layer.id}
        onPointerDown={editable ? (e) => startDrag(layer, e) : undefined}
        style={{ cursor: interactive ? (dragging ? 'grabbing' : 'grab') : editable ? 'pointer' : 'default', opacity: textEffect.opacity }}
        filter={layer.kind === 'text' ? textEffect.filter : undefined}
      >
        {content}
        {interactive && <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="transparent" />}
        {selected && (
          <rect x={box.x - 2} y={box.y - 2} width={box.w + 4} height={box.h + 4} rx="2" fill="none" stroke="#6366f1" strokeWidth={sleeveView ? 0.6 : 1.2} strokeDasharray="4 3" />
        )}
      </g>
    );
  };

  const sidesOnFace = SIDES.filter((s) => SIDE_FACE[s] === face);

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      className={`h-auto w-full select-none ${className}`}
      role="img"
      aria-label={`${specs.garmentType || 'T-shirt'} preview, ${view} view`}
      tabIndex={editable ? 0 : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={editable ? () => onSelect?.(null) : undefined}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ touchAction: editable ? 'none' : undefined, outline: 'none' }}
    >
      <defs>
        <clipPath id={`body-${uid}`}>
          <path d={BODY[garment]} />
        </clipPath>
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

      <g transform={viewTransform}>
        {!sleeveView && <ellipse cx="200" cy="446" rx="130" ry="8" fill="#0f172a" opacity="0.08" />}
        <path d={BODY[garment]} fill={color} />
        <path d={BODY[garment]} fill={`url(#${fabricPattern}-${uid})`} />
        {detailsFor(garment, face).map((d, i) => (
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
        <path d={BODY[garment]} fill={`url(#light-${uid})`} />
        <path d={BODY[garment]} fill={`url(#fold-${uid})`} />
        <path d={BODY[garment]} fill="none" stroke={shade(color, -38)} strokeWidth={sleeveView ? 0.8 : 1.6} strokeLinejoin="round" />

        <g clipPath={`url(#body-${uid})`}>
          {sidesOnFace.map((side) => {
            const area = areas[side];
            const showArea = editable && side === view && (showPrintArea || dragging);
            return (
              <g
                key={side}
                ref={(el) => {
                  areaRefs.current[side] = el;
                }}
                transform={areaTransform(area)}
              >
                {showArea && (
                  <rect x="0" y="0" width={area.w} height={area.h} rx="4" fill="none" stroke="#6366f1" strokeWidth={sleeveView ? 0.6 : 1.2} strokeDasharray="5 4" opacity="0.7" />
                )}
                {allLayers.filter((l) => l.side === side).map((l) => renderLayer(l, area))}
              </g>
            );
          })}
        </g>
      </g>

      {!sleeveView && (
        <text x="200" y="458" textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="Inter, sans-serif" letterSpacing="2">
          {face.toUpperCase()}
        </text>
      )}
    </svg>
  );
}
