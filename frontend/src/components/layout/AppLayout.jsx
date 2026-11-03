import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, ChevronDown, Gavel, History, Scale, ShieldCheck, Users, LayoutDashboard, LogOut, Menu, Package, PencilRuler, Radio, Shirt, UserCircle, Wallet, Wifi, WifiOff, X } from 'lucide-react';
import { useAuth, roleHome } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import NotificationBell from './NotificationBell';
import { cx } from '../ui';
import { initials } from '../../utils/format';

const NAV = {
  buyer: [
    { to: '/buyer', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/buyer/rfqs/new', label: 'Design & Launch', icon: PencilRuler },
    { to: '/buyer/rfqs', label: 'My Auctions', icon: Gavel, end: true },
    { to: '/buyer/orders', label: 'Orders', icon: Package },
  ],
  vendor: [
    { to: '/vendor', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/vendor/rfqs', label: 'Live RFQs', icon: Radio },
    { to: '/vendor/bids', label: 'My Bids', icon: History },
    { to: '/vendor/orders', label: 'Orders', icon: Package },
    { to: '/vendor/wallet', label: 'Wallet', icon: Wallet },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/vendors', label: 'Vendors', icon: ShieldCheck },
    { to: '/admin/auctions', label: 'Auctions', icon: Radio },
    { to: '/admin/disputes', label: 'Disputes', icon: Scale },
    { to: '/admin/orders', label: 'Escrow', icon: Package },
    { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/admin/users', label: 'Users', icon: Users },
  ],
};

const ROLE_LABEL = { buyer: 'Buyer', vendor: 'Vendor (SME)', admin: 'Administrator' };

export function Logo({ to = '/' }) {
  return (
    <Link to={to} className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
        <Shirt className="h-5 w-5" />
      </span>
      <span className="text-xl font-extrabold tracking-tight text-slate-900">
        Custom<span className="text-brand-600">T</span>
      </span>
    </Link>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">{initials(user.name)}</span>
        <span className="hidden text-left md:block">
          <span className="block max-w-[10rem] truncate text-sm font-medium text-slate-900">{user.companyName || user.name}</span>
          <span className="block text-xs text-slate-500">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 md:block" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-56 animate-slide-up overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          <div className="border-b border-slate-100 px-4 py-2">
            <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setOpen(false);
              navigate('/account');
            }}
          >
            <UserCircle className="h-4 w-4" /> Account & wallet
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { user } = useAuth();
  const { connected } = useSocket();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const links = NAV[user.role] || [];

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const linkClass = ({ isActive }) =>
    cx(
      'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <button type="button" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 xl:hidden" onClick={() => setMobileOpen((v) => !v)} aria-label="Menu">
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Logo to={roleHome(user.role)} />
            <nav className="hidden items-center gap-1 xl:flex">
              {links.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={linkClass}>
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <span
              className={cx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex', connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}
              title={connected ? 'Real-time connection active' : 'Reconnecting to live updates…'}
            >
              {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {connected ? 'Live' : 'Offline'}
            </span>
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
        {mobileOpen && (
          <nav className="border-t border-slate-100 bg-white px-4 py-3 xl:hidden">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={linkClass}>
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
