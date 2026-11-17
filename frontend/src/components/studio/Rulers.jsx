import { useLayoutEffect, useRef, useState } from 'react';
import { unitsPer } from '../../utils/units';

const SIZE = 20; // ruler thickness in px
const LABEL_STEPS = { cm: [1, 2, 5, 10, 20, 25, 50, 100], in: [0.5, 1, 2, 5, 10, 20, 50] };
const MIN_LABEL_GAP = 44; // px between labelled ticks

/**
 * Top and left rulers for the pattern editor, in centimetres or inches. They follow the editor's zoom and
 * pan through `viewport` ({ k, x, y, origin }: screen px = x + k·layoutUnit), reported by TShirtPreview.
 * Zero is the top-left of the piece area.
 */
export default function Rulers({ viewport, unit = 'cm' }) {
  const box = useRef(null);
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect((prev) => (prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height ? prev : { left: r.left, top: r.top, width: r.width, height: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('scroll', measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', measure, true);
    };
  }, [viewport]);

  const ticks = (length, start, pxPerUnit) => {
    if (!pxPerUnit) return { major: [], minor: [] };
    const label = LABEL_STEPS[unit].find((s) => s * pxPerUnit >= MIN_LABEL_GAP) || LABEL_STEPS[unit].at(-1);
    const minor = label / (unit === 'cm' ? (label >= 10 ? 10 : label >= 5 ? 5 : label) : label >= 1 ? 4 : 2);
    const from = Math.floor(-start / pxPerUnit / minor) * minor;
    const to = (length - start) / pxPerUnit;
    const major = [];
    const small = [];
    for (let v = from; v <= to; v = Math.round((v + minor) * 1000) / 1000) {
      const px = start + v * pxPerUnit;
      if (px < SIZE - 1) continue;
      const isMajor = Math.abs(v / label - Math.round(v / label)) < 1e-6;
      (isMajor ? major : small).push({ v, px });
    }
    return { major, minor: small };
  };

  const ready = viewport && rect;
  const pxPerUnit = ready ? viewport.k * unitsPer(unit) : 0;
  // Ruler zero (piece-area corner) in px relative to this overlay.
  const x0 = ready ? viewport.x + viewport.k * viewport.origin.x - rect.left : 0;
  const y0 = ready ? viewport.y + viewport.k * viewport.origin.y - rect.top : 0;
  const top = ready ? ticks(rect.width, x0, pxPerUnit) : { major: [], minor: [] };
  const left = ready ? ticks(rect.height, y0, pxPerUnit) : { major: [], minor: [] };
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  return (
    <div ref={box} className="pointer-events-none absolute inset-0" aria-hidden="true">
      {ready && (
        <>
          <svg className="absolute left-0 top-0" width={rect.width} height={SIZE}>
            <rect width={rect.width} height={SIZE} fill="rgba(24,24,27,0.92)" />
            <line x1="0" x2={rect.width} y1={SIZE - 0.5} y2={SIZE - 0.5} stroke="rgba(255,255,255,0.12)" />
            {top.minor.map((t) => (
              <line key={`m${t.v}`} x1={t.px} x2={t.px} y1={SIZE - 5} y2={SIZE} stroke="rgba(255,255,255,0.25)" />
            ))}
            {top.major.map((t) => (
              <g key={`M${t.v}`}>
                <line x1={t.px} x2={t.px} y1={SIZE - 10} y2={SIZE} stroke="rgba(255,255,255,0.5)" />
                <text x={t.px + 3} y={10} fontSize="9" fill="#a1a1aa" fontFamily="JetBrains Mono, monospace">
                  {fmt(t.v)}
                </text>
              </g>
            ))}
          </svg>
          <svg className="absolute left-0 top-0" width={SIZE} height={rect.height}>
            <rect width={SIZE} height={rect.height} fill="rgba(24,24,27,0.92)" />
            <line y1="0" y2={rect.height} x1={SIZE - 0.5} x2={SIZE - 0.5} stroke="rgba(255,255,255,0.12)" />
            {left.minor.map((t) => (
              <line key={`m${t.v}`} y1={t.px} y2={t.px} x1={SIZE - 5} x2={SIZE} stroke="rgba(255,255,255,0.25)" />
            ))}
            {left.major.map((t) => (
              <g key={`M${t.v}`}>
                <line y1={t.px} y2={t.px} x1={SIZE - 10} x2={SIZE} stroke="rgba(255,255,255,0.5)" />
                <text x={10} y={t.px + 3} fontSize="9" fill="#a1a1aa" fontFamily="JetBrains Mono, monospace" transform={`rotate(-90 10 ${t.px + 3})`} textAnchor="end">
                  {fmt(t.v)}
                </text>
              </g>
            ))}
          </svg>
          <div className="absolute left-0 top-0 flex items-center justify-center bg-zinc-900 font-mono text-[9px] text-zinc-400" style={{ width: SIZE, height: SIZE }}>
            {unit}
          </div>
        </>
      )}
    </div>
  );
}
