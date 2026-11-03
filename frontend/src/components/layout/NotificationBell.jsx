import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { cx } from '../ui';
import { formatRelative } from '../../utils/format';

const TONE_DOT = { info: 'bg-sky-500', success: 'bg-emerald-500', warning: 'bg-amber-500' };

/** Where clicking a notification should take the user, by role. */
function targetFor(notification, role) {
  const p = notification.payload || {};
  if (role === 'buyer') {
    if (p.orderId) return `/buyer/orders/${p.orderId}`;
    if (p.rfqId) return `/buyer/rfqs/${p.rfqId}`;
  }
  if (role === 'vendor') {
    if (p.orderId) return `/vendor/orders/${p.orderId}`;
    if (p.rfqId) return `/vendor/rfqs/${p.rfqId}`;
    if (p.rfq?._id) return `/vendor/rfqs/${p.rfq._id}`;
    if (notification.event?.startsWith('vendor:')) return '/account';
  }
  if (role === 'admin') {
    if (p.orderId) return `/admin/orders/${p.orderId}`;
    if (notification.event === 'vendor:registered') return '/admin/vendors?status=pending';
    if (p.rfqId || p.rfq) return '/admin/auctions';
  }
  return null;
}

export default function NotificationBell() {
  const { notifications, markAllRead, clearNotifications } = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) markAllRead();
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`}>
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-slide-up overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="font-semibold text-slate-900">Notifications</p>
            <div className="flex gap-1">
              <button type="button" onClick={markAllRead} className="rounded p-1 text-slate-400 hover:text-slate-600" title="Mark all read">
                <CheckCheck className="h-4 w-4" />
              </button>
              <button type="button" onClick={clearNotifications} className="rounded p-1 text-slate-400 hover:text-slate-600" title="Clear">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">You're all caught up. Live auction and order updates will appear here.</p>
            ) : (
              notifications.map((n) => {
                const target = targetFor(n, user?.role);
                return (
                  <button
                    key={n.id}
                    type="button"
                    disabled={!target}
                    onClick={() => {
                      setOpen(false);
                      if (target) navigate(target);
                    }}
                    className="flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 disabled:cursor-default"
                  >
                    <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', TONE_DOT[n.tone] || 'bg-slate-400')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                      <span className="line-clamp-2 block text-sm text-slate-600">{n.text}</span>
                      <span className="mt-0.5 block text-xs text-slate-400">{formatRelative(n.at)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
