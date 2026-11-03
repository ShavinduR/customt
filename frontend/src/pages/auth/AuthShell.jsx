import { Gavel, ShieldCheck, Shirt, Users } from 'lucide-react';
import { Logo } from '../../components/layout/AppLayout';

const POINTS = [
  { icon: Shirt, title: 'Design visually', text: 'Configure garment, fabric, colour and artwork on a live preview.' },
  { icon: Gavel, title: 'Let printers compete', text: 'Verified SMEs bid in a real-time, multi-attribute reverse auction.' },
  { icon: ShieldCheck, title: 'Pay with confidence', text: 'Split escrow and an offline O2O PIN keep your money safe.' },
];

export default function AuthShell({ title, subtitle, children, wide = false }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-violet-600 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-2 text-xl font-extrabold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-600">
            <Shirt className="h-5 w-5" />
          </span>
          CustomT
        </div>
        <div className="relative">
          <h2 className="font-display text-5xl leading-none tracking-wide xl:text-6xl">
            Custom apparel,
            <br />
            procured fairly.
          </h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="flex gap-4">
                <span className="rounded-xl bg-white/15 p-2.5">
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="text-sm text-white/80">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-sm text-white/70">
          <Users className="h-4 w-4" /> A centralized marketplace for Sri Lankan SME apparel printers
        </p>
      </aside>
      <main className="flex items-start justify-center px-4 py-10 sm:items-center sm:px-8">
        <div className={wide ? 'w-full max-w-xl' : 'w-full max-w-md'}>
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
