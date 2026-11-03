import { Check } from 'lucide-react';
import { cx } from '../ui';

/** Selectable card used for garment, fabric, print-type and placement choices. */
export default function OptionCard({ selected, onClick, title, description, icon: Icon, children, compact = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'relative flex w-full items-start gap-3 rounded-xl border text-left transition',
        compact ? 'p-3' : 'p-4',
        selected ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-200' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      )}
    >
      {Icon && (
        <span className={cx('rounded-lg p-2', selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}>
          <Icon className="h-4 w-4" />
        </span>
      )}
      {children}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{description}</span>}
      </span>
      {selected && (
        <span className="absolute right-2 top-2 rounded-full bg-brand-600 p-0.5 text-white">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}
