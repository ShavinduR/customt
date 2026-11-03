import { useEffect, useRef, useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { Card, cx } from '../ui';

/**
 * Chart primitives for the admin analytics (light theme, validated palette).
 * Categorical slots (fixed order, never cycled): 1 blue #2a78d6, 2 orange #eb6834.
 * Marks: bars <= 24px with 4px rounded data-end and square baseline, 2px surface gap,
 * hairline solid gridlines, legend for >= 2 series, hover tooltip, table view toggle.
 */
export const SERIES = ['#2a78d6', '#eb6834'];
const GRID = '#e8e8e4';
const AXIS_TEXT = '#52514e';
const RANGE_FILL = '#b7d3f6';

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(value) {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

/** Rounded data-end (top), square at the baseline. */
function columnPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Card with title, legend and a Chart/Table toggle (the accessible table view). */
export function ChartCard({ title, subtitle, legend, table, children, className }) {
  const [mode, setMode] = useState('chart');
  return (
    <Card className={cx('p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        {table && (
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {[
              ['chart', BarChart3, 'Chart view'],
              ['table', Table2, 'Table view'],
            ].map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cx('rounded-md p-1.5', mode === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === 'chart' && legend && <div className="mb-3">{legend}</div>}
      {mode === 'chart' || !table ? children : table}
    </Card>
  );
}

export function DataTable({ columns, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th key={c.key} className={cx('px-3 py-2 font-medium', c.align === 'right' && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={cx('px-3 py-2 text-slate-700', c.align === 'right' && 'text-right font-mono')}>
                  {c.format ? c.format(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Grouped column chart, one y-axis. data: [{ label, ...values }], series: [{ key, label, color }].
 */
export function ColumnChart({ data, series, height = 240, formatValue = (v) => v }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const margin = { top: 12, right: 8, bottom: 28, left: 40 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] || 0))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const band = data.length ? innerW / data.length : 0;
  const gap = 2;
  const barW = Math.max(2, Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v) => innerH - (v / max) * innerH;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Column chart">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={AXIS_TEXT}>
                  {formatValue(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = i * band + (band - groupW) / 2;
              return (
                <g key={d.label}>
                  {series.map((s, si) => {
                    const v = d[s.key] || 0;
                    return <path key={s.key} d={columnPath(x0 + si * (barW + gap), y(v), barW, innerH - y(v))} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
                  })}
                  <text x={i * band + band / 2} y={innerH + 18} textAnchor="middle" fontSize="11" fill={AXIS_TEXT}>
                    {d.label}
                  </text>
                  <rect x={i * band} y={0} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.label}: ${series.map((s) => `${s.label} ${formatValue(d[s.key] || 0)}`).join(', ')}`} />
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(width - 150, margin.left + hover * band + band / 2 + 8), top: margin.top }}
        >
          <p className="font-semibold text-slate-900">{data[hover].label}</p>
          {series.map((s) => (
            <p key={s.key} className="mt-0.5 flex items-center gap-1.5 text-slate-600">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}: <span className="font-mono font-semibold text-slate-900">{formatValue(data[hover][s.key] || 0)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Range + dot plot (min–max band with the average marked). rows: [{ label, min, avg, max, hint }] */
export function RangeDotChart({ rows, formatValue = (v) => v }) {
  const [hover, setHover] = useState(null);
  const max = niceMax(Math.max(0, ...rows.map((r) => r.max)));
  const pct = (v) => `${(v / max) * 100}%`;
  return (
    <div className="space-y-4">
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="truncate text-sm text-slate-700">{r.label}</span>
          <div className="relative h-6" tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${r.label}: average ${formatValue(r.avg)}, range ${formatValue(r.min)} to ${formatValue(r.max)}`}>
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ backgroundColor: GRID }} />
            <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full" style={{ left: pct(r.min), width: `calc(${pct(r.max - r.min)} + 2px)`, backgroundColor: RANGE_FILL }} />
            <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style={{ left: pct(r.avg), backgroundColor: SERIES[0] }} />
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg" style={{ left: pct(r.avg) }}>
                <p className="font-semibold text-slate-900">{r.label}</p>
                <p className="text-slate-600">
                  Avg <span className="font-mono font-semibold text-slate-900">{formatValue(r.avg)}</span> · range {formatValue(r.min)}–{formatValue(r.max)}
                </p>
                {r.hint && <p className="text-slate-500">{r.hint}</p>}
              </div>
            )}
          </div>
          <span className="w-24 text-right font-mono text-sm font-semibold text-slate-900">{formatValue(r.avg)}</span>
        </div>
      ))}
      <div className="grid grid-cols-[7rem_1fr_auto] gap-3 text-[11px] text-slate-500">
        <span />
        <div className="flex justify-between">
          <span>0</span>
          <span>{formatValue(max / 2)}</span>
          <span>{formatValue(max)}</span>
        </div>
        <span className="w-24" />
      </div>
      <div className="flex gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SERIES[0] }} /> Average unit price
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full" style={{ backgroundColor: RANGE_FILL }} /> Min–max range
        </span>
      </div>
    </div>
  );
}

/** Single-series horizontal bar list. items: [{ label, value, hint? }] */
export function BarList({ items, formatValue = (v) => v }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm" title={item.hint}>
          <span className="truncate text-slate-700">{item.label}</span>
          <span className="h-3 rounded-r-[4px] bg-slate-100">
            <span className="block h-3 rounded-r-[4px]" style={{ width: `${(item.value / max) * 100}%`, backgroundColor: SERIES[0], minWidth: item.value ? 4 : 0 }} />
          </span>
          <span className="text-right font-mono font-semibold text-slate-900">{formatValue(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}
