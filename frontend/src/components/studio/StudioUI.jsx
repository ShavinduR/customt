import { cx } from '../ui';

/**
 * Dark "studio" primitives for the design studio (zinc surfaces, CustomT brand indigo accents).
 * The rest of the app keeps the light design system in components/ui.
 */

export const studioInput =
  'w-full rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30';

export function Panel({ className, children, ...props }) {
  return (
    <section className={cx('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/80 shadow-xl shadow-black/20', className)} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({ icon: Icon, title, children }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {Icon && <Icon className="h-3.5 w-3.5 text-brand-400" />}
        {title}
      </h2>
      {children}
    </div>
  );
}

export function Group({ title, hint, action, children, className }) {
  return (
    <div className={cx('space-y-2.5', className)}>
      {(title || action) && (
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-zinc-200">{title}</h3>
          {action}
        </div>
      )}
      {children}
      {hint && <p className="text-xs leading-relaxed text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Segmented control / tab strip. options: [{ value, label, icon?, badge? }] */
export function Segmented({ options, value, onChange, className, size = 'md', label }) {
  return (
    <div className={cx('flex rounded-xl bg-zinc-950/70 p-1 ring-1 ring-white/[0.06]', className)} role="tablist" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
              size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active ? 'bg-zinc-800 text-white shadow ring-1 ring-white/10' : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            {Icon && <Icon className={cx('h-3.5 w-3.5', active && 'text-brand-400')} />}
            <span className="truncate">{o.label}</span>
            {o.badge ? <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-bold leading-4 text-white">{o.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Selectable tile (garment, fabric, print method). */
export function Tile({ selected, onClick, title, description, icon: Icon, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'group flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
        selected ? 'border-brand-400/70 bg-brand-500/10 ring-1 ring-brand-400/40' : 'border-white/[0.07] bg-zinc-950/40 hover:border-white/15 hover:bg-zinc-800/50',
        className
      )}
    >
      {Icon && (
        <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', selected ? 'bg-brand-500 text-white' : 'bg-zinc-800 text-zinc-400 group-hover:text-zinc-200')}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="min-w-0">
        <span className={cx('block text-sm font-semibold', selected ? 'text-white' : 'text-zinc-200')}>{title}</span>
        {description && <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-zinc-500">{description}</span>}
      </span>
    </button>
  );
}

export function IconButton({ icon: Icon, label, className, active, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'flex h-8 w-8 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-35',
        active ? 'bg-brand-500/15 text-brand-300' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white disabled:hover:bg-transparent disabled:hover:text-zinc-400',
        className
      )}
      {...props}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function StudioButton({ variant = 'secondary', icon: Icon, className, children, loading, disabled, ...props }) {
  const styles = {
    primary: 'bg-brand-500 text-white shadow-lg shadow-brand-500/25 hover:bg-brand-400',
    secondary: 'bg-zinc-800 text-zinc-100 ring-1 ring-white/10 hover:bg-zinc-700',
    ghost: 'text-zinc-300 hover:bg-white/[0.06] hover:text-white',
    danger: 'text-red-300 hover:bg-red-500/10 hover:text-red-200',
  }[variant];
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50',
        styles,
        className
      )}
      {...props}
    >
      {Icon && <Icon className={cx('h-4 w-4', loading && 'animate-spin')} />}
      {children}
    </button>
  );
}

/** Labelled range slider with a value readout. Pass `group` handling through onChange. */
export function Slider({ id, label, value, display, min, max, step = 1, onChange, onReset }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <label htmlFor={id} className="font-medium text-zinc-300">
          {label}
        </label>
        <span className="flex items-center gap-2">
          {onReset && (
            <button type="button" onClick={onReset} className="text-zinc-500 hover:text-brand-300">
              Reset
            </button>
          )}
          <span className="min-w-[3.5rem] rounded-md bg-zinc-950/70 px-1.5 py-0.5 text-right font-mono text-zinc-200 ring-1 ring-white/[0.06]">{display ?? value}</span>
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="studio-range w-full" />
    </div>
  );
}

export function Kbd({ children }) {
  return <kbd className="rounded border border-white/10 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-400">{children}</kbd>;
}
