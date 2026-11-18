import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, LayoutTemplate } from 'lucide-react';
import { cx } from '../ui';
import { BODY } from '../../utils/garmentGeometry';
import { PLACEMENT_GROUPS, applyPlacement, placementsFor } from '../../utils/placements';
import { formatLength, unitsPer } from '../../utils/units';

/** Presets for the layer's garment, with the one the layer currently sits at marked `active`. */
function usePresets(specs, layer) {
  const garment = BODY[specs.garmentType] ? specs.garmentType : 'Crew Neck';
  return placementsFor(garment).map((p) => {
    const patch = layer ? applyPlacement(layer, p, garment) : null;
    const active = Boolean(layer && layer.side === patch.side && Math.abs(layer.x - patch.x) < 1.5 && Math.abs(layer.y - patch.y) < 1.5);
    return { ...p, patch, active };
  });
}

const widthLabel = (p, units) => formatLength(p.width * unitsPer('cm'), units);

/** Artwork tab: all presets grouped by side. Clicking one moves and sizes the selected layer (one undo step). */
export function PlacementGrid({ specs, layer, onApply, units = 'cm' }) {
  const presets = usePresets(specs, layer);
  return (
    <div className="space-y-2.5">
      {PLACEMENT_GROUPS.map((g) => (
        <div key={g.side}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{g.label}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {presets
              .filter((p) => p.group === g.side)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onApply(p)}
                  aria-pressed={p.active}
                  title={p.hint}
                  className={cx(
                    'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition',
                    p.active ? 'border-brand-400/70 bg-brand-500/15 text-white' : 'border-white/[0.07] bg-zinc-950/40 text-zinc-300 hover:border-white/15 hover:text-white'
                  )}
                >
                  <span className="truncate font-medium">{p.label}</span>
                  <span className={cx('shrink-0 font-mono text-[10px]', p.active ? 'text-brand-200' : 'text-zinc-500')}>{widthLabel(p, units)}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const MENU_W = 256;

/**
 * 2D editor toolbar: a compact "Place" menu with the same presets. The menu is portalled to <body> and
 * positioned above the button, because the toolbar scrolls sideways on small screens and would clip it.
 */
export function PlacementMenu({ specs, layer, onApply, units = 'cm' }) {
  const [pos, setPos] = useState(null);
  const button = useRef(null);
  const menu = useRef(null);
  const presets = usePresets(specs, layer);
  const open = Boolean(pos);

  const toggle = () => {
    if (open) return setPos(null);
    const r = button.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - MENU_W / 2), window.innerWidth - MENU_W - 8);
    return setPos({ left, bottom: window.innerHeight - r.top + 8 });
  };

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key !== 'Escape' : menu.current?.contains(e.target) || button.current?.contains(e.target)) return;
      setPos(null);
    };
    const dismiss = () => setPos(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cx('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition', open ? 'bg-brand-500 text-white' : 'text-zinc-200 hover:bg-white/10')}
      >
        <LayoutTemplate className="h-3.5 w-3.5" /> Place
      </button>
      {open &&
        createPortal(
        <div ref={menu} role="menu" aria-label="Placement presets" style={{ left: pos.left, bottom: pos.bottom, width: MENU_W }} className="fixed z-[65] max-h-[70vh] overflow-y-auto rounded-xl border border-white/15 bg-zinc-900/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
          {PLACEMENT_GROUPS.map((g) => (
            <div key={g.side} className="py-0.5">
              <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{g.label}</p>
              {presets
                .filter((p) => p.group === g.side)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onApply(p);
                      setPos(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10 hover:text-white"
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{p.active && <Check className="h-3.5 w-3.5 text-brand-300" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{p.label}</span>
                      <span className="block truncate text-[10px] text-zinc-500">{p.hint}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-400">{widthLabel(p, units)}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>,
          document.body
        )}
    </div>
  );
}
