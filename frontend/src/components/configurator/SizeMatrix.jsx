import { Minus, Plus } from 'lucide-react';
import { cx } from '../ui';

const PRESETS = [
  { label: 'Even 50', values: { S: 10, M: 10, L: 10, XL: 10, XXL: 10 } },
  { label: 'Event 100', values: { S: 15, M: 30, L: 30, XL: 15, XXL: 10 } },
  { label: 'Staff 250', values: { S: 30, M: 70, L: 80, XL: 50, XXL: 20 } },
];

/** Size breakdown grid; totals and MOQ status are derived by the parent. */
export default function SizeMatrix({ sizes, value, onChange, total, moq }) {
  const set = (size, raw) => {
    const n = Math.max(0, Math.min(10000, Number.parseInt(raw, 10) || 0));
    onChange({ ...value, [size]: n });
  };
  const pct = Math.min(100, Math.round((total / moq) * 100));
  const met = total >= moq;

  return (
    <div>
      <div className="grid grid-cols-5 gap-2">
        {sizes.map((size) => (
          <div key={size} className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-center">
            <label htmlFor={`size-${size}`} className="block text-xs font-bold tracking-wide text-slate-500">
              {size}
            </label>
            <input
              id={`size-${size}`}
              type="number"
              inputMode="numeric"
              min="0"
              value={value[size] ?? 0}
              onChange={(e) => set(size, e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-1 py-1.5 text-center font-mono text-base font-semibold text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-1.5 flex justify-center gap-1">
              <button type="button" onClick={() => set(size, (value[size] || 0) - 5)} className="rounded bg-white p-0.5 text-slate-500 ring-1 ring-slate-200 hover:text-slate-800" aria-label={`Remove 5 ${size}`}>
                <Minus className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => set(size, (value[size] || 0) + 5)} className="rounded bg-white p-0.5 text-slate-500 ring-1 ring-slate-200 hover:text-slate-800" aria-label={`Add 5 ${size}`}>
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => onChange(p.values)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700">
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => onChange(Object.fromEntries(sizes.map((s) => [s, 0])))} className="rounded-full px-3 py-1 text-xs font-medium text-slate-400 hover:text-slate-600">
          Clear
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-slate-600">
            Total quantity: <span className="font-mono text-lg font-bold text-slate-900">{total}</span> pcs
          </span>
          <span className={cx('font-medium', met ? 'text-emerald-600' : 'text-amber-600')}>{met ? 'Minimum order met' : `${moq - total} more to reach MOQ ${moq}`}</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={cx('h-full rounded-full transition-all', met ? 'bg-emerald-500' : 'bg-amber-400')} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
