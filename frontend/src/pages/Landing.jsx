import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Gavel, KeyRound, Lock, PencilRuler, Scale, ShieldCheck, Timer } from 'lucide-react';
import { Logo } from '../components/layout/AppLayout';
import TShirtPreview from '../components/configurator/TShirtPreview';

const HERO_SPECS = {
  garmentType: 'Crew Neck',
  fabric: '100% Cotton',
  gsm: 180,
  color: '#4F46E5',
  printType: 'Screen Printing',
  printPlacement: 'FRONT',
  customText: 'COLOMBO RUN 2026',
  textColor: '#FFFFFF',
  designPosition: { x: 50, y: 30, scale: 1.1 },
};

const MODULES = [
  {
    icon: PencilRuler,
    title: 'Visual configurator → technical RFQ',
    text: 'Pick garment, fabric, GSM, colour and print method, place your artwork and size matrix. CustomT converts it into a structured, locked specification.',
    points: ['Automatic quantity & delivery estimate', 'Minimum order quantity enforced', 'Specs locked once bidding opens'],
  },
  {
    icon: Gavel,
    title: 'Real-time reverse auction',
    text: 'Only prequalified printers with the right capability and capacity can bid. Bids are ranked live on price, trust and lead time.',
    points: ['Multi-round re-bidding', 'Vendors see only their own rank', 'Soft-close stops last-second sniping'],
  },
  {
    icon: ShieldCheck,
    title: 'Escrow & O2O verification',
    text: 'Your payment is held in escrow: 30% at production start, 70% only after you physically inspect the goods and share your PIN.',
    points: ['Mock payment gateway', '6-digit PIN + QR hand-over', 'Polite, mediated disputes'],
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link to="/login" className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Sign in
          </Link>
          <Link to="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
            Get started
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-2 lg:pt-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
            <BadgeCheck className="h-3.5 w-3.5" /> Prequalified SME printers only
          </span>
          <h1 className="mt-5 font-display text-6xl leading-[0.95] tracking-wide text-slate-900 sm:text-7xl">
            Design it. <span className="text-brand-600">Auction it.</span> Pay safely.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600">
            CustomT is a centralized marketplace for custom apparel. Turn your T-shirt idea into a precise RFQ, let verified printers compete in a live reverse auction,
            and release payment only when the goods pass your inspection.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white shadow-sm hover:bg-brand-700">
              Start a design <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/register" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 font-semibold text-slate-700 hover:bg-slate-50">
              Join as a printer
            </Link>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 text-center">
            {[
              [Timer, '24 h', 'auction window'],
              [Scale, '3', 'scoring factors'],
              [Lock, '2-step', 'escrow release'],
            ].map(([Icon, value, label]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <Icon className="mx-auto h-5 w-5 text-brand-600" />
                <dt className="mt-1 text-lg font-bold text-slate-900">{value}</dt>
                <dd className="text-xs text-slate-500">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="relative mx-auto w-full max-w-md">
          <div className="absolute inset-8 rounded-full bg-brand-100 blur-3xl" />
          <div className="relative rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-xl backdrop-blur">
            <TShirtPreview specs={HERO_SPECS} />
            <div className="mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 font-medium text-slate-700">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live: 5 bids
              </span>
              <span className="font-mono text-slate-500">Rank #1 · score 0.9111</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-slate-100 bg-slate-50 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Three integrated modules</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-slate-600">From the first sketch to the final hand-over, every step is structured, transparent and protected.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {MODULES.map(({ icon: Icon, title, text, points }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <span className="inline-flex rounded-xl bg-brand-600 p-2.5 text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm text-slate-600">{text}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
                  {points.map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 text-brand-500" /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="py-8 text-center text-sm text-slate-500">CustomT · Centralized E-commerce Marketplace & Reverse Auction Platform for Custom Apparel Procurement</footer>
    </div>
  );
}
