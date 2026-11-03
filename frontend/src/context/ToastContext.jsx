import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cx } from '../components/ui';

const ToastContext = createContext(null);

const TONES = {
  success: { Icon: CheckCircle2, cls: 'border-emerald-200', icon: 'text-emerald-500' },
  error: { Icon: XCircle, cls: 'border-red-200', icon: 'text-red-500' },
  warning: { Icon: AlertTriangle, cls: 'border-amber-200', icon: 'text-amber-500' },
  info: { Icon: Info, cls: 'border-sky-200', icon: 'text-sky-500' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (tone, message, { title, duration = 5000 } = {}) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((list) => [...list.slice(-4), { id, tone, message, title }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      success: (msg, opts) => push('success', msg, opts),
      error: (msg, opts) => push('error', msg, { duration: 7000, ...opts }),
      warning: (msg, opts) => push('warning', msg, { duration: 7000, ...opts }),
      info: (msg, opts) => push('info', msg, opts),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:right-0 sm:top-16 sm:items-end">
        {toasts.map((toast) => {
          const { Icon, cls, icon } = TONES[toast.tone];
          return (
            <div key={toast.id} className={cx('pointer-events-auto flex w-full max-w-sm animate-slide-up gap-3 rounded-xl border bg-white p-4 shadow-lg', cls)}>
              <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', icon)} />
              <div className="min-w-0 flex-1 text-sm">
                {toast.title && <p className="font-semibold text-slate-900">{toast.title}</p>}
                <p className="whitespace-pre-line text-slate-600">{toast.message}</p>
              </div>
              <button type="button" onClick={() => dismiss(toast.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
