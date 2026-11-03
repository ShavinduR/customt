import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle, Star } from 'lucide-react';
import { statusMeta } from '../../utils/status';
import { formatCountdown } from '../../utils/format';

export const cx = (...classes) => classes.filter(Boolean).join(' ');

// ─────────────────────────── Buttons ───────────────────────────

const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-brand-500',
  ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500 shadow-sm',
  outlineDanger: 'border border-red-300 text-red-700 bg-white hover:bg-red-50 focus-visible:ring-red-500',
};
const BUTTON_SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export function Button({ variant = 'primary', size = 'md', loading = false, icon: Icon, className, children, disabled, type = 'button', ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

// ─────────────────────────── Surfaces ───────────────────────────

export function Card({ className, children, ...props }) {
  return (
    <div className={cx('rounded-2xl border border-slate-200 bg-white shadow-sm', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon: Icon, action, className }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="mt-0.5 rounded-lg bg-brand-50 p-2 text-brand-600">
            <Icon className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {Icon && (
          <div className={cx('rounded-lg p-2', tones[tone])}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

// ─────────────────────────── Badges ───────────────────────────

const BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function Badge({ tone = 'slate', icon: Icon, className, children }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE_TONES[tone], className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }) {
  const meta = statusMeta(status);
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.pulse && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      )}
      {meta.label}
    </Badge>
  );
}

export function TrustStars({ score = 0, size = 'sm', showValue = true }) {
  const px = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
  return (
    <span className="inline-flex items-center gap-1" title={`Trust score ${Number(score).toFixed(2)} / 5`}>
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map((i) => {
          const fill = Math.max(0, Math.min(1, score - (i - 1)));
          return (
            <span key={i} className={cx('relative', px)}>
              <Star className={cx('absolute inset-0 text-slate-300', px)} />
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={cx('fill-amber-400 text-amber-400', px)} />
              </span>
            </span>
          );
        })}
      </span>
      {showValue && <span className="text-xs font-semibold text-slate-700">{Number(score).toFixed(2)}</span>}
    </span>
  );
}

// ─────────────────────────── Feedback ───────────────────────────

const ALERT_TONES = {
  info: { cls: 'border-sky-200 bg-sky-50 text-sky-900', Icon: Info },
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', Icon: CheckCircle2 },
  warning: { cls: 'border-amber-200 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  danger: { cls: 'border-red-200 bg-red-50 text-red-900', Icon: XCircle },
};

export function Alert({ tone = 'info', title, children, className, icon }) {
  const { cls, Icon } = ALERT_TONES[tone];
  const UseIcon = icon || Icon;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border p-4 text-sm', cls, className)}>
      <UseIcon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-1', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorList({ error }) {
  if (!error) return null;
  const details = Array.isArray(error.details) ? error.details : null;
  return (
    <Alert tone="danger" title={error.message}>
      {details && (
        <ul className="list-disc space-y-0.5 pl-4">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function Spinner({ className, label }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 text-slate-500', className)}>
      <Loader2 className="h-5 w-5 animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function PageLoader({ label = 'Loading…' }) {
  return <Spinner className="py-24" label={label} />;
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {Icon && (
        <div className="rounded-full bg-slate-100 p-3 text-slate-500">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─────────────────────────── Modal ───────────────────────────

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', dismissible = true }) {
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-[2px]" onClick={() => dismissible && onClose?.()} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('relative flex max-h-[92vh] w-full animate-slide-up flex-col rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl', widths[size])}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {dismissible && (
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────── Form controls ───────────────────────────

export function Field({ label, hint, error, required, children, htmlFor, className }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const inputBase =
  'block w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500';
const inputTone = (invalid) => (invalid ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-100');

export function Input({ invalid, className, icon: Icon, ...props }) {
  if (Icon) {
    return (
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className={cx(inputBase, inputTone(invalid), 'h-10 pl-9', className)} {...props} />
      </div>
    );
  }
  return <input className={cx(inputBase, inputTone(invalid), 'h-10', className)} {...props} />;
}

export function Select({ invalid, className, children, ...props }) {
  return (
    <select className={cx(inputBase, inputTone(invalid), 'h-10 pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className, ...props }) {
  return <textarea className={cx(inputBase, inputTone(invalid), 'py-2', className)} {...props} />;
}

// ─────────────────────────── Countdown ───────────────────────────

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Live auction timer. Turns red inside the soft-close window. */
export function Countdown({ expiresAt, softCloseMs = 120000, compact = false }) {
  const now = useNow(1000);
  const remaining = expiresAt ? new Date(expiresAt).getTime() - now : 0;
  const ended = remaining <= 0;
  const urgent = !ended && remaining <= softCloseMs;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg font-mono font-bold tabular-nums',
        compact ? 'text-sm' : 'px-3 py-1.5 text-lg',
        ended ? 'text-slate-400' : urgent ? (compact ? 'text-red-600' : 'animate-pulse bg-red-50 text-red-600') : compact ? 'text-slate-800' : 'bg-slate-100 text-slate-800'
      )}
      title={urgent ? 'Soft-close window: any new bid extends the auction by 5 minutes' : undefined}
    >
      {ended ? 'Ended' : formatCountdown(remaining)}
    </span>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cx(
            'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition',
            value === tab.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-xs text-slate-600">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
