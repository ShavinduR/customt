import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';

/**
 * Spotlight tour: dims the page, cuts a highlighted window around one element per step and shows a
 * card beside it (Skip / Back / Next). Steps point at elements by `data-tour="<target>"`; a step with no
 * target is a centred welcome card. Keyboard: ← → to move, Esc to skip.
 *
 * steps: [{ target?, title, body, icon? }]
 */

const PAD = 8;
const GAP = 14;
const MARGIN = 12;
const CARD_W = 360;

function useTargetRect(target, active) {
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    if (!active || !target) {
      setRect(null);
      return undefined;
    }
    const el = document.querySelector(`[data-tour="${target}"]`);
    if (!el) {
      setRect(null);
      return undefined;
    }
    // The app's sticky header stays above the page, so the spotlight must start below it.
    const headerBottom = () => Math.max(0, document.querySelector('header')?.getBoundingClientRect().bottom || 0);
    const measure = () => {
      const r = el.getBoundingClientRect();
      // Clip to the viewport (below the header) so a tall panel still gets a sensible spotlight.
      const top = Math.max(MARGIN, headerBottom() + 4, r.top - PAD);
      const left = Math.max(MARGIN, r.left - PAD);
      const bottom = Math.min(window.innerHeight - MARGIN, r.bottom + PAD);
      const right = Math.min(window.innerWidth - MARGIN, r.right + PAD);
      setRect({ top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
    };
    const r = el.getBoundingClientRect();
    const head = headerBottom();
    const room = window.innerHeight - head;
    if (r.top < head + PAD || r.bottom > window.innerHeight - PAD) {
      // Tall targets: align their top just under the header. Others: centre them in the space below it.
      const offset = r.height > room * 0.7 ? head + 16 : head + (room - r.height) / 2;
      window.scrollTo({ top: window.scrollY + r.top - offset, behavior: 'smooth' });
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [target, active]);

  return rect;
}

/** Card position: beside the spotlight where it fits (right, left, below, above), else centred. */
function placeCard(rect, cardH) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 2 * MARGIN);
  const clampX = (x) => Math.min(Math.max(MARGIN, x), vw - w - MARGIN);
  const clampY = (y) => Math.min(Math.max(MARGIN, y), vh - cardH - MARGIN);
  if (!rect) return { width: w, left: (vw - w) / 2, top: Math.max(MARGIN, (vh - cardH) / 2) };
  const midY = rect.top + rect.height / 2 - cardH / 2;
  if (vw >= 768) {
    if (rect.left + rect.width + GAP + w + MARGIN <= vw) return { width: w, left: rect.left + rect.width + GAP, top: clampY(midY) };
    if (rect.left - GAP - w >= MARGIN) return { width: w, left: rect.left - GAP - w, top: clampY(midY) };
  }
  const below = vh - (rect.top + rect.height) - GAP - MARGIN;
  const above = rect.top - GAP - MARGIN;
  const left = clampX(rect.left + rect.width / 2 - w / 2);
  if (below >= cardH) return { width: w, left, top: rect.top + rect.height + GAP };
  if (above >= cardH) return { width: w, left, top: rect.top - GAP - cardH };
  // Nowhere fits (e.g. a panel that fills a phone screen): float the card over the bottom of the spotlight.
  return { width: w, left, top: vh - cardH - MARGIN };
}

export default function GuidedTour({ steps, open, onClose, label = 'Guided tour' }) {
  const [index, setIndex] = useState(0);
  const [cardH, setCardH] = useState(220);
  const cardRef = useRef(null);
  const nextRef = useRef(null);
  const step = steps[index];
  const rect = useTargetRect(step?.target, open);
  const last = index === steps.length - 1;

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [index, open, rect?.width]);

  useEffect(() => {
    if (open) nextRef.current?.focus({ preventScroll: true });
  }, [open, index]);

  const finish = useCallback((completed) => onClose?.({ completed, step: index }), [onClose, index]);
  const next = useCallback(() => (last ? finish(true) : setIndex((i) => i + 1)), [last, finish]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, finish]);

  if (!open || !step) return null;
  const pos = placeCard(rect, cardH);
  const Icon = step.icon;

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={label} aria-describedby="tour-body">
      {/* Blocks clicks on the page underneath while the tour is open. */}
      <div className="absolute inset-0" />
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-brand-400 motion-safe:transition-all motion-safe:duration-300"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, boxShadow: '0 0 0 9999px rgba(9, 9, 11, 0.72), 0 0 40px 4px rgba(99, 102, 241, 0.35)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-950/75 backdrop-blur-[2px]" />
      )}

      <div
        ref={cardRef}
        className="absolute rounded-2xl border border-white/10 bg-zinc-900/95 p-5 text-zinc-100 shadow-2xl shadow-black/50 backdrop-blur-xl motion-safe:transition-[top,left] motion-safe:duration-300"
        style={pos}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {Icon && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-500/30">
                <Icon className="h-4 w-4 text-white" />
              </span>
            )}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-300">
                Step {index + 1} of {steps.length}
              </p>
              <h2 className="text-base font-semibold text-white">{step.title}</h2>
            </div>
          </div>
          <button type="button" onClick={() => finish(false)} className="rounded-lg p-1 text-zinc-500 hover:bg-white/10 hover:text-white" aria-label="Close tour">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div id="tour-body" className="mt-3 space-y-2 text-sm leading-relaxed text-zinc-300">
          {step.body}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.title} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-brand-400' : i < index ? 'w-1.5 bg-brand-400/50' : 'w-1.5 bg-white/15'}`} />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {index === 0 ? (
              <button type="button" onClick={() => finish(false)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-400 hover:bg-white/10 hover:text-white">
                Skip
              </button>
            ) : (
              <button type="button" onClick={back} className="flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-white/10 hover:text-white">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
            <button
              ref={nextRef}
              type="button"
              onClick={next}
              className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-brand-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 hover:bg-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              {last ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Start designing
                </>
              ) : (
                <>
                  {index === 0 ? 'Show me' : 'Next'} <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Opens a tour automatically the first time (per browser), and lets the page replay it. */
export function useFirstVisitTour(storageKey, { ready = true, delay = 900 } = {}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready) return undefined;
    let seen = true;
    try {
      seen = Boolean(localStorage.getItem(storageKey));
    } catch {
      /* storage unavailable: don't nag */
    }
    if (seen) return undefined;
    const t = setTimeout(() => setOpen(true), delay);
    return () => clearTimeout(t);
  }, [storageKey, ready, delay]);

  const close = useCallback(
    (result) => {
      setOpen(false);
      try {
        localStorage.setItem(storageKey, JSON.stringify({ at: new Date().toISOString(), completed: Boolean(result?.completed), step: result?.step ?? 0 }));
      } catch {
        /* ignore */
      }
    },
    [storageKey]
  );
  return { open, start: () => setOpen(true), close };
}
