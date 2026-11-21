import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Box,
  Camera,
  Check,
  FileArchive,
  Gavel,
  KeyRound,
  Lock,
  Ruler,
  Scissors,
  ShieldCheck,
  Store,
  Users,
} from 'lucide-react';
import { InstallAppButton } from '../context/PwaContext';

const PhotoMockupView = lazy(() => import('../components/configurator/PhotoMockupView'));

/** Hero sample: the photo preview recolours live as the visitor (or the timer) picks a colour. */
const HERO_COLOURS = [
  { hex: '#1E4FA3', name: 'Royal blue', ink: '#FFFFFF' },
  { hex: '#C0392B', name: 'Red', ink: '#FFFFFF' },
  { hex: '#1F6F6B', name: 'Teal', ink: '#FFFFFF' },
  { hex: '#111111', name: 'Black', ink: '#E9B44C' },
  { hex: '#E9B44C', name: 'Gold', ink: '#1B2A41' },
  { hex: '#F8FAFC', name: 'White', ink: '#1B2A41' },
];
const heroSpecs = (colour, garmentType = 'Crew Neck') => ({
  garmentType,
  fabric: '100% Cotton',
  gsm: 180,
  color: colour.hex,
  printType: 'Screen Printing',
  textLayers: [
    { id: 'h1', side: 'front', text: 'BATCH 2026', font: 'Bebas Neue', size: 52, color: colour.ink, x: 50, y: 36, rotation: 0 },
    { id: 'h2', side: 'front', text: 'Class of 2026', font: 'Montserrat', size: 11, color: colour.ink, x: 50, y: 50, rotation: 0 },
    { id: 'h3', side: 'back', text: 'CREW', font: 'Montserrat', size: 34, color: colour.ink, x: 50, y: 14, rotation: 0 },
  ],
  imageLayers: [],
  sizeBreakdown: { S: 10, M: 20, L: 20, XL: 10, XXL: 5 },
});

const SHOWCASE = [
  {
    garment: 'V-Neck',
    colour: { hex: '#1F6F6B', ink: '#FFFFFF' },
    lines: [['NEGOMBO', 'Bebas Neue', 54, 34], ['STAFF', 'Montserrat', 14, 47]],
    label: 'Staff V-neck',
  },
  {
    garment: 'Polo',
    colour: { hex: '#1B2A41', ink: '#E9B44C' },
    lines: [['Kandy Prints', 'Playfair Display', 24, 14]],
    label: 'Company polo',
    chest: true,
  },
  {
    garment: 'Crew Neck',
    colour: { hex: '#C0392B', ink: '#FFFFFF' },
    lines: [['COLOMBO', 'Bebas Neue', 50, 30], ['RUN 2026', 'Bebas Neue', 50, 43]],
    label: 'Event T-shirt',
  },
];
const showcaseSpecs = ({ garment, colour, lines, chest }) => ({
  garmentType: garment,
  fabric: '100% Cotton',
  gsm: 180,
  color: colour.hex,
  printType: 'Screen Printing',
  textLayers: lines.map(([text, font, size, y], i) => ({ id: `s${i}`, side: 'front', text, font, size, color: colour.ink, x: chest ? 78 : 50, y, rotation: 0 })),
  imageLayers: [],
  sizeBreakdown: { M: 20 },
});

const STEPS = [
  {
    title: 'Design',
    text: 'Pick a garment and colour, add your text or logo and drag it where you want it. See it on a real photo, in 3D, or as cut pieces with real centimetres.',
  },
  {
    title: 'Compare bids',
    text: 'Your design becomes a precise quotation. Verified local printers bid live for 24 hours and are ranked on price, rating and delivery time.',
  },
  {
    title: 'Pay safely',
    text: 'You pay into escrow. The printer gets 30% when printing starts and the rest only after you check the shirts and share your PIN.',
  },
];

const FEATURES = [
  [Camera, 'Photo preview', 'Your design on a real garment photo, in any colour, following the fabric folds.'],
  [Box, 'Live 3D', 'Turn the shirt around. Smooth even on everyday phones.'],
  [Scissors, 'Cut pieces', 'Front, back and sleeves laid flat like a real sewing pattern.'],
  [Ruler, 'Real sizes', 'cm and inch rulers, print areas and one-click placements such as "left chest, 9 cm".'],
  [BadgeCheck, 'Print check', 'Warns you before a logo would print blurry or get cut off.'],
  [FileArchive, 'Print-ready files', 'The winning printer gets a spec sheet and 300 DPI files, so nothing is guessed.'],
];

const ESCROW_FLOW = ['Bid accepted', 'You pay into escrow', '30% released when printing starts', 'You inspect the shirts', 'You share your PIN', 'Final 70% released'];

const FAQ = [
  ['Do I need design skills?', 'No. Type your text, upload your logo and drag it on the shirt. One-click placements put a logo on the left chest or across the back at the right size.'],
  ['Who are the printers?', 'Local printing businesses that applied to sell on CustomT and passed a business check (BR, owner NIC, utility bill and invoices) by an administrator.'],
  ['What if the shirts are wrong?', 'Do not share your PIN. Open a dispute instead: the final payment stays frozen in escrow while an administrator mediates a reprint, a partial refund or a full refund.'],
  ['Is there a minimum order?', 'Yes, a small minimum per order so printers can quote fairly. The design studio shows it while you enter sizes.'],
];

function HeroMockup() {
  const [index, setIndex] = useState(0);
  const [face, setFace] = useState('front');
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % HERO_COLOURS.length), 3500);
    return () => clearInterval(t);
  }, [auto]);
  const colour = HERO_COLOURS[index];
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="absolute -inset-4 rotate-2 rounded-[2rem] bg-sand" aria-hidden="true" />
      <div className="relative rounded-[1.75rem] border border-[#e4dccb] bg-[radial-gradient(ellipse_at_50%_35%,#fff_0%,#f3eee4_70%,#e9e2d4_100%)] p-5 shadow-[0_18px_40px_-18px_rgba(27,42,65,0.45)]">
        <div className="aspect-[8/9]">
          <Suspense fallback={null}>
            <PhotoMockupView specs={heroSpecs(colour)} face={face} className="h-full w-full" label={`Photo preview: ${colour.name} T-shirt, ${face}`} />
          </Suspense>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5" role="radiogroup" aria-label="Shirt colour">
            {HERO_COLOURS.map((c, i) => (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={i === index}
                aria-label={c.name}
                title={c.name}
                onClick={() => {
                  setAuto(false);
                  setIndex(i);
                }}
                className={`h-7 w-7 rounded-full border-2 border-black/15 transition hover:scale-110 ${i === index ? 'outline outline-[3px] outline-offset-2 outline-ember' : ''}`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border-2 border-ink text-sm font-semibold">
            {['front', 'back'].map((f) => (
              <button key={f} type="button" aria-pressed={face === f} onClick={() => setFace(f)} className={`px-3 py-1 ${face === f ? 'bg-ink text-white' : 'text-ink'}`}>
                {f === 'front' ? 'Front' : 'Back'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -left-3 -top-4 flex items-center gap-2 rounded-xl border border-[#e4dccb] bg-white px-3 py-2 text-sm shadow-lg">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <span>
          <strong className="text-ink">5 printers</strong> <span className="text-[#5d6675]">bidding now</span>
        </span>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-paper font-friendly text-ink">
      <header className="sticky top-0 z-20 border-b border-[#e4dccb] bg-paper/95 px-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 py-4">
          <Link to="/" className="font-serif text-2xl font-extrabold tracking-tight text-ink">
            Custom<span className="text-brand-600">T</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-[#5d6675] md:flex" aria-label="Sections">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#studio" className="hover:text-ink">Design studio</a>
            <a href="#safe" className="hover:text-ink">Why it&apos;s safe</a>
            <a href="#printers" className="hover:text-ink">For printers</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-ink hover:bg-sand">
              Sign in
            </Link>
            <Link to="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-brand-700">
              Start designing
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 pb-20 pt-12 sm:px-6 lg:pt-20">
        <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <p className="text-sm font-bold text-ember">Custom T-shirts for events, teams and businesses in Sri Lanka</p>
          <h1 className="mt-3 font-serif text-[clamp(2.4rem,5vw,4rem)] font-extrabold leading-[1.05] tracking-tight">
            Design your shirt. Let printers <span className="text-brand-600">compete</span> for your order.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#5d6675]">
            No more WhatsApp screenshots and bank transfers to strangers. Design it here, verified local printers bid for the job, and your money stays in
            escrow until you have checked the shirts.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3.5 font-bold text-white shadow-[0_6px_0_rgba(27,42,65,0.18)] transition hover:-translate-y-0.5 hover:bg-brand-700"
            >
              Start designing <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#how" className="inline-flex items-center gap-2 rounded-xl border-2 border-ink px-6 py-3 font-bold text-ink transition hover:-translate-y-0.5">
              See how it works
            </a>
            <InstallAppButton size="lg" variant="ghost" label="Install the app" />
          </div>
          <ul className="mt-9 grid gap-2 text-sm font-medium sm:grid-cols-3">
            {['Verified printers only', 'Payment held in escrow', 'Pay in full only after inspection'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold">
                  <Check className="h-3 w-3 text-ink" strokeWidth={3} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <HeroMockup />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 border-t border-[#e4dccb] px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <h2 className="font-serif text-4xl font-extrabold">Three steps, no chasing</h2>
          <p className="mt-3 max-w-2xl text-[#5d6675]">From the first idea to shirts in your hands, every step is clear, compared and protected.</p>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <article key={s.title} className="rounded-2xl border border-[#e4dccb] bg-[#fffdf8] p-7">
                <span className="inline-grid h-10 w-10 place-items-center rounded-full bg-gold font-serif text-lg font-extrabold">{i + 1}</span>
                <h3 className="mt-4 font-serif text-xl font-extrabold">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-[#5d6675]">{s.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Studio showcase */}
      <section id="studio" className="scroll-mt-20 bg-sand px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <h2 className="font-serif text-4xl font-extrabold">See it before it&apos;s made</h2>
              <p className="mt-3 max-w-xl text-[#5d6675]">
                A design studio built for real production: what you approve is exactly what the printer prints. Six garments, any colour.
              </p>
              <ul className="mt-8 grid gap-4 sm:grid-cols-2">
                {FEATURES.map(([Icon, title, text]) => (
                  <li key={title} className="flex gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-white">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <strong className="block">{title}</strong>
                      <span className="text-sm leading-relaxed text-[#5d6675]">{text}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Link to="/register" className="mt-9 inline-flex items-center gap-2 font-bold text-brand-700 hover:underline">
                Open the design studio <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {SHOWCASE.map((item, i) => (
                <figure key={item.label} className={`rounded-2xl border border-[#e4dccb] bg-[#fffdf8] p-2 shadow-sm ${i === 1 ? 'lg:-translate-y-6' : ''}`}>
                  <div className="aspect-[8/9]">
                    <Suspense fallback={null}>
                      <PhotoMockupView specs={showcaseSpecs(item)} face="front" className="h-full w-full" label={item.label} />
                    </Suspense>
                  </div>
                  <figcaption className="pb-1 text-center text-xs font-semibold text-[#5d6675]">{item.label}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Escrow */}
      <section id="safe" className="scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <h2 className="font-serif text-4xl font-extrabold">Why your money is safe</h2>
          <p className="mt-3 max-w-2xl text-[#5d6675]">
            CustomT holds the payment, not the printer. You meet the printer to check the shirts, and the final payment only moves when you are happy.
          </p>
          <ol className="mt-9 flex flex-wrap gap-2.5">
            {ESCROW_FLOW.map((step, i) => (
              <li key={step} className="flex items-center gap-2 rounded-full border border-[#e4dccb] bg-[#fffdf8] px-4 py-2.5 font-medium">
                <span className="font-bold text-ember">{i + 1}.</span> {step}
              </li>
            ))}
          </ol>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              [Lock, 'Escrow, not trust', 'Your full payment is held by CustomT. Nobody can take it and disappear.'],
              [KeyRound, 'Your PIN releases it', 'A one-time PIN that only you hold. Share it only when the shirts are right.'],
              [ShieldCheck, 'Disputes are mediated', 'Something wrong? The payment is frozen while an administrator helps settle it fairly.'],
            ].map(([Icon, title, text]) => (
              <div key={title} className="rounded-2xl border-l-4 border-emerald-600 bg-[#e5f3e6] p-6">
                <Icon className="h-5 w-5 text-emerald-700" />
                <h3 className="mt-3 font-bold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[#3d5a45]">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Printers */}
      <section id="printers" className="scroll-mt-20 bg-ink px-4 py-20 text-white sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="font-serif text-4xl font-extrabold">Printers: win fair work, get paid</h2>
            <p className="mt-3 max-w-xl text-white/70">
              Clear orders with exact sizes and print-ready files, a fair live auction, and an advance as soon as you start printing.
            </p>
            <Link to="/register" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gold px-6 py-3.5 font-bold text-ink transition hover:-translate-y-0.5">
              <Store className="h-4 w-4" /> Join as a printer
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {[
              [Gavel, 'Fair auctions', 'You see your own rank, never other bids. Last-minute sniping is blocked.'],
              [Users, 'Real buyers', 'Schools, companies, clubs and events with confirmed quantities.'],
              [FileArchive, 'No guessing', 'Spec sheet with sizes in cm and 300 DPI print files for every side.'],
              [ShieldCheck, 'Paid on time', '30% when you start printing, the rest when the buyer confirms.'],
            ].map(([Icon, title, text]) => (
              <li key={title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <Icon className="h-5 w-5 text-gold" />
                <strong className="mt-3 block">{title}</strong>
                <span className="text-sm text-white/65">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center font-serif text-4xl font-extrabold">Questions</h2>
          <div className="mt-8 divide-y divide-[#e4dccb] rounded-2xl border border-[#e4dccb] bg-[#fffdf8]">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold">
                  {q}
                  <span className="text-2xl leading-none text-ember transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 leading-relaxed text-[#5d6675]">{a}</p>
              </details>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link to="/register" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-7 py-4 text-lg font-bold text-white transition hover:-translate-y-0.5 hover:bg-brand-700">
              Design your first shirt <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#e4dccb] px-4 py-8 text-center text-sm text-[#5d6675] sm:px-6">
        CustomT · Custom apparel marketplace with live printer auctions and escrow ·{' '}
        <a href="/privacy" className="hover:underline">
          Privacy
        </a>
      </footer>
    </div>
  );
}
