import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { shade } from '../../utils/status';

/**
 * Layered SVG garment renderer used by the configurator (editable) and by auction/order pages (read-only).
 * Layers: base colour → fabric texture → lighting → construction details (collar, hood, seams) → artwork.
 */

const BODY = {
  'Crew Neck':
    'M128 42 C145 34 158 30 166 28 C178 46 222 46 234 28 C242 30 255 34 272 42 L352 84 C356 86 357 90 355 94 L328 156 C326 160 322 161 318 159 L298 149 L300 418 C300 424 296 428 290 428 L110 428 C104 428 100 424 100 418 L102 149 L82 159 C78 161 74 160 72 156 L45 94 C43 90 44 86 48 84 Z',
  Polo:
    'M128 42 C145 34 158 30 166 28 C178 46 222 46 234 28 C242 30 255 34 272 42 L346 80 C350 82 352 86 350 90 L330 140 C328 144 324 146 320 144 L298 136 L300 418 C300 424 296 428 290 428 L110 428 C104 428 100 424 100 418 L102 136 L80 144 C76 146 72 144 70 140 L50 90 C48 86 50 82 54 80 Z',
  Hoodie:
    'M126 46 C146 38 158 34 166 32 C178 48 222 48 234 32 C242 34 254 38 274 46 L338 76 C350 82 356 92 358 104 L378 372 C379 380 374 386 366 387 L338 390 C330 391 324 386 323 378 L302 176 L304 420 C304 426 300 430 294 430 L106 430 C100 430 96 426 96 420 L98 176 L77 378 C76 386 70 391 62 390 L34 387 C26 386 21 380 22 372 L42 104 C44 92 50 82 62 76 Z',
};

/** Printable area per garment and side, in SVG units. */
const PRINT_AREA = {
  'Crew Neck': { front: { x: 135, y: 80, w: 130, h: 250 }, back: { x: 130, y: 65, w: 140, h: 280 } },
  Polo: { front: { x: 132, y: 140, w: 136, h: 190 }, back: { x: 130, y: 70, w: 140, h: 280 } },
  Hoodie: { front: { x: 138, y: 135, w: 124, h: 180 }, back: { x: 130, y: 140, w: 140, h: 220 } },
};

function wrapText(text, maxChars = 14, maxLines = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
    return kept;
  }
  return lines;
}

function contentFor(view, specs) {
  const placement = specs.printPlacement || 'FRONT';
  const logo = specs.logoUrl || '';
  if (placement === 'FRONT') return view === 'front' ? { logo, text: specs.customText } : null;
  if (placement === 'BACK') return view === 'back' ? { logo, text: specs.customText || specs.backText } : null;
  return view === 'front' ? { logo, text: specs.customText } : { logo: '', text: specs.backText || specs.customText };
}

function GarmentDetails({ garment, view, color }) {
  const dark = shade(color, -28);
  const darker = shade(color, -42);
  const seam = shade(color, -18);

  if (garment === 'Hoodie') {
    return (
      <g>
        <path d="M322 366 L377 360 L378 372 C379 380 374 386 366 387 L338 390 C330 391 324 386 323 378 Z" fill={shade(color, -10)} />
        <path d="M78 366 L23 360 L22 372 C21 380 26 386 34 387 L62 390 C70 391 76 386 77 378 Z" fill={shade(color, -10)} />
        <path d="M96 404 L304 404 L304 420 C304 426 300 430 294 430 L106 430 C100 430 96 426 96 420 Z" fill={shade(color, -10)} />
        <path d="M98 176 C104 130 112 80 126 46 M302 176 C296 130 288 80 274 46" stroke={seam} strokeWidth="1.2" fill="none" />
        {view === 'front' ? (
          <>
            <path d="M132 322 L268 322 L290 396 L110 396 Z" fill="none" stroke={dark} strokeWidth="2" />
            <path d="M138 328 L262 328" stroke={seam} strokeWidth="1" strokeDasharray="3 3" />
            <path d="M150 40 C150 0 250 0 250 40 C246 62 226 74 200 76 C174 74 154 62 150 40 Z" fill={shade(color, -12)} stroke={dark} strokeWidth="1.5" />
            <path d="M165 38 C168 14 232 14 235 38 C230 54 216 62 200 62 C184 62 170 54 165 38 Z" fill={darker} />
          </>
        ) : (
          <>
            <path d="M146 44 C146 0 254 0 254 44 L244 120 C230 132 170 132 156 120 Z" fill={shade(color, -6)} stroke={dark} strokeWidth="1.5" />
            <path d="M200 6 L200 128" stroke={seam} strokeWidth="1.2" />
          </>
        )}
      </g>
    );
  }

  if (garment === 'Polo') {
    return (
      <g>
        <path d="M102 136 C110 100 118 68 128 42 M298 136 C290 100 282 68 272 42" stroke={seam} strokeWidth="1.2" fill="none" />
        <path d="M320 144 L298 136 M80 144 L102 136" stroke={dark} strokeWidth="1.2" />
        <path d="M100 412 L300 412" stroke={seam} strokeWidth="1" strokeDasharray="4 3" />
        {view === 'front' ? (
          <>
            <path d="M166 28 C178 46 222 46 234 28 C222 34 178 34 166 28 Z" fill={darker} />
            <rect x="191" y="44" width="18" height="84" rx="3" fill={shade(color, -6)} stroke={dark} strokeWidth="1.2" />
            {[66, 88, 110].map((cy) => (
              <circle key={cy} cx="200" cy={cy} r="3.2" fill={shade(color, 25)} stroke={dark} strokeWidth="0.8" />
            ))}
            <path d="M166 28 L148 60 L194 76 L200 46 Z" fill={shade(color, -4)} stroke={dark} strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M234 28 L252 60 L206 76 L200 46 Z" fill={shade(color, -4)} stroke={dark} strokeWidth="1.4" strokeLinejoin="round" />
          </>
        ) : (
          <path d="M160 24 C180 16 220 16 240 24 L246 42 C228 34 172 34 154 42 Z" fill={shade(color, -8)} stroke={dark} strokeWidth="1.4" />
        )}
      </g>
    );
  }

  // Crew Neck
  return (
    <g>
      <path d="M102 149 C112 110 120 70 128 42 M298 149 C288 110 280 70 272 42" stroke={seam} strokeWidth="1.2" fill="none" />
      <path d="M100 412 L300 412" stroke={seam} strokeWidth="1" strokeDasharray="4 3" />
      <path d="M78 150 L52 98 M322 150 L348 98" stroke={seam} strokeWidth="1" strokeDasharray="3 3" />
      {view === 'front' ? (
        <>
          <path d="M166 28 C178 58 222 58 234 28 C222 36 178 36 166 28 Z" fill={darker} />
          <path d="M166 28 C178 58 222 58 234 28" stroke={dark} strokeWidth="6" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <path d="M166 28 C180 40 220 40 234 28" stroke={dark} strokeWidth="6" fill="none" strokeLinecap="round" />
      )}
    </g>
  );
}

export default function TShirtPreview({ specs, view = 'front', editable = false, onPositionChange, className = '', showPrintArea = false }) {
  const uid = useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const garment = BODY[specs.garmentType] ? specs.garmentType : 'Crew Neck';
  const color = specs.color || '#FFFFFF';
  const textColor = specs.textColor || '#111827';
  const area = PRINT_AREA[garment][view];
  const position = specs.designPosition || { x: 50, y: 35, scale: 1 };
  const content = contentFor(view, specs);
  const hasContent = Boolean(content && (content.logo || (content.text && content.text.trim())));
  const fabricPattern = specs.fabric === 'Pique/Crocodile' ? 'pique' : specs.fabric === 'Dry-Fit/Wetlook' ? 'mesh' : 'cotton';
  const printType = specs.printType || 'Screen Printing';

  const lines = useMemo(() => (content?.text ? wrapText(content.text) : []), [content?.text]);
  const fontSize = lines.some((l) => l.length > 10) ? 22 : 30;
  const lineHeight = fontSize * 0.95;

  const cx = area.x + (area.w * position.x) / 100;
  const cy = area.y + (area.h * position.y) / 100;
  const logoSize = 92;
  const logoY = lines.length ? -logoSize / 2 - (lines.length * lineHeight) / 2 - 4 : -logoSize / 2;
  const textStartY = content?.logo ? logoY + logoSize + fontSize : -((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35;

  const toSvgPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    return ctm ? point.matrixTransform(ctm.inverse()) : null;
  }, []);

  const updateFromPointer = (event) => {
    const p = toSvgPoint(event.clientX, event.clientY);
    if (!p || !onPositionChange) return;
    const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
    onPositionChange({ ...position, x: clamp(((p.x - area.x) / area.w) * 100), y: clamp(((p.y - area.y) / area.h) * 100) });
  };

  const onKeyDown = (event) => {
    if (!editable || !onPositionChange) return;
    const step = event.shiftKey ? 10 : 2;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const clamp = (v) => Math.max(0, Math.min(100, v));
    onPositionChange({ ...position, x: clamp(position.x + delta[0]), y: clamp(position.y + delta[1]) });
  };

  const effect = {
    'Screen Printing': { filter: undefined, opacity: 1, stroke: undefined },
    DTF: { filter: `url(#gloss-${uid})`, opacity: 1, stroke: undefined },
    Embroidery: { filter: `url(#stitch-${uid})`, opacity: 1, stroke: { color: shade(textColor, -35), dash: '2.2 1.4' } },
    Sublimation: { filter: undefined, opacity: 0.88, stroke: undefined },
  }[printType] || {};

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 400 460"
      className={`h-auto w-full select-none ${className}`}
      role="img"
      aria-label={`${specs.garmentType || 'T-shirt'} preview, ${view} view`}
      onPointerMove={(e) => dragging && updateFromPointer(e)}
      onPointerUp={() => setDragging(false)}
      onPointerLeave={() => setDragging(false)}
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

      <ellipse cx="200" cy="446" rx="130" ry="8" fill="#0f172a" opacity="0.08" />

      {/* Base colour + fabric + lighting */}
      <path d={BODY[garment]} fill={color} />
      <path d={BODY[garment]} fill={`url(#${fabricPattern}-${uid})`} />
      <GarmentDetails garment={garment} view={view} color={color} />
      <path d={BODY[garment]} fill={`url(#light-${uid})`} />
      <path d={BODY[garment]} fill={`url(#fold-${uid})`} />
      <path d={BODY[garment]} fill="none" stroke={shade(color, -38)} strokeWidth="1.6" strokeLinejoin="round" />

      {editable && (showPrintArea || dragging) && (
        <rect x={area.x} y={area.y} width={area.w} height={area.h} rx="6" fill="none" stroke="#6366f1" strokeWidth="1.2" strokeDasharray="5 4" opacity="0.7" />
      )}

      {hasContent && (
        <g clipPath={`url(#body-${uid})`}>
          <g
            transform={`translate(${cx} ${cy}) scale(${position.scale || 1})`}
            style={{ cursor: editable ? (dragging ? 'grabbing' : 'grab') : 'default', opacity: effect.opacity, outline: 'none' }}
            tabIndex={editable ? 0 : undefined}
            role={editable ? 'slider' : undefined}
            aria-label={editable ? 'Artwork position. Drag, or use arrow keys to move.' : undefined}
            aria-valuetext={editable ? `x ${position.x}%, y ${position.y}%` : undefined}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              if (!editable) return;
              e.preventDefault();
              svgRef.current?.setPointerCapture?.(e.pointerId);
              setDragging(true);
            }}
            filter={effect.filter}
          >
            {editable && (
              <rect
                x={-70}
                y={content.logo ? logoY - 6 : -((lines.length * lineHeight) / 2) - 10}
                width={140}
                height={(content.logo ? logoSize + 12 : 0) + lines.length * lineHeight + 16}
                fill="transparent"
                stroke={dragging ? '#6366f1' : 'transparent'}
                strokeDasharray="4 3"
                rx="6"
              />
            )}
            {content.logo && (
              <image href={content.logo} x={-logoSize / 2} y={logoY} width={logoSize} height={logoSize} preserveAspectRatio="xMidYMid meet" />
            )}
            {lines.map((line, i) => (
              <text
                key={`${line}-${i}`}
                x="0"
                y={textStartY + i * lineHeight}
                textAnchor="middle"
                fontFamily="'Bebas Neue', Impact, sans-serif"
                fontSize={fontSize}
                letterSpacing="1.5"
                fill={textColor}
                stroke={effect.stroke?.color}
                strokeWidth={effect.stroke ? 0.9 : undefined}
                strokeDasharray={effect.stroke?.dash}
              >
                {line}
              </text>
            ))}
          </g>
        </g>
      )}

      <text x="200" y="458" textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="Inter, sans-serif" letterSpacing="2">
        {view.toUpperCase()}
      </text>
    </svg>
  );
}
