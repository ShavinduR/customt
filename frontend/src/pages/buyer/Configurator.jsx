import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  CalendarClock,
  CircleAlert,
  Camera,
  CircleCheck,
  Columns2,
  Compass,
  Droplets,
  Layers,
  Loader2,
  Lock,
  Move3d,
  Minus,
  PenTool,
  Plus,
  Redo2,
  RotateCcw,
  Rocket,
  Scissors,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  Store,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { rfqApi, storefrontApi } from '../../api/client';
import { useCatalog } from '../../context/CatalogContext';
import { useToast } from '../../context/ToastContext';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import useHistory, { useUndoShortcuts } from '../../hooks/useHistory';
import TShirtPreview from '../../components/configurator/TShirtPreview';
import GuidedTour, { useFirstVisitTour } from '../../components/tour/GuidedTour';
import { Alert, Button, ErrorList, Modal, PageLoader, cx } from '../../components/ui';
import { Group, IconButton, Kbd, Panel, PanelHeader, Segmented, StudioButton, Tile, studioInput } from '../../components/studio/StudioUI';
import { LayerInspector, LayerList, PatternEditor, allLayersOf, useArtwork } from '../../components/studio/ArtworkPanels';
import { COLOR_SWATCHES, FABRIC_INFO, GARMENT_INFO, PRINT_TYPE_INFO } from '../../utils/status';
import { SIDE_LABEL } from '../../utils/garmentGeometry';
import { hasPhotoMockup } from '../../utils/photoMockup';
import { estimateDeliveryDays, layersOf, printedSides } from '../../utils/design';

const Shirt3DViewer = lazy(() => import('../../components/configurator/Shirt3DViewer'));
const PhotoMockupView = lazy(() => import('../../components/configurator/PhotoMockupView'));

const DRAFT_KEY = 'customt_rfq_draft_v2';
const LEGACY_DRAFT_KEY = 'customt_rfq_draft_v1';
const PRINT_ICONS = { 'Screen Printing': Layers, DTF: Sparkles, Embroidery: Scissors, Sublimation: Droplets };
const GSM_HINT = { 160: 'Light', 180: 'Standard', 200: 'Heavy', 220: 'Premium' };
const SIZE_PRESETS = [
  { label: 'Even 50', values: { S: 10, M: 10, L: 10, XL: 10, XXL: 10 } },
  { label: 'Event 100', values: { S: 15, M: 30, L: 30, XL: 15, XXL: 10 } },
  { label: 'Staff 250', values: { S: 30, M: 70, L: 80, XL: 50, XXL: 20 } },
];

const DEFAULT_SPECS = {
  garmentType: 'Crew Neck',
  fabric: '100% Cotton',
  gsm: 180,
  color: '#1E3A8A',
  printType: 'Screen Printing',
  textLayers: [
    { id: 'tfront', side: 'front', text: 'CUSTOMT EVENT 2026', font: 'Bebas Neue', size: 28, color: '#FFFFFF', x: 50, y: 30, rotation: 0 },
    { id: 'tback', side: 'back', text: 'CREW', font: 'Montserrat', size: 40, color: '#FFFFFF', x: 50, y: 25, rotation: 0 },
  ],
  imageLayers: [],
  sizeBreakdown: { S: 10, M: 20, L: 20, XL: 10, XXL: 5 },
};

const DESIGN_FIELDS = ['garmentType', 'fabric', 'gsm', 'color', 'printType', 'sizeBreakdown'];

/** Keeps only the fields the layered configurator edits; older single-text designs become layers. */
function toLayeredSpecs(specs) {
  const base = Object.fromEntries(DESIGN_FIELDS.filter((k) => specs[k] !== undefined).map((k) => [k, specs[k]]));
  return { ...DEFAULT_SPECS, ...base, ...layersOf(specs) };
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw);
      return draft?.specs ? { ...draft, specs: toLayeredSpecs(draft.specs) } : null;
    }
    const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (!legacy) return null;
    const draft = JSON.parse(legacy);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    return draft?.specs ? { ...draft, specs: toLayeredSpecs(draft.specs) } : null;
  } catch {
    return null;
  }
}

function saveDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable */
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Calendar date of delivery: today + the 24-hour auction + `days`. */
const dateAfterDays = (days) => isoDate(new Date(Date.now() + (Number(days) + 1) * DAY_MS));
/** Delivery days for a "needed by" date (inverse of dateAfterDays); null for an empty/invalid date. */
function daysUntil(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((new Date(y, m - 1, d) - start) / DAY_MS) - 1;
}

/* ─────────────────────────── Right panel: Garment tab ─────────────────────────── */

function GarmentTab({ catalog, specs, update }) {
  return (
    <div className="space-y-6">
      <Group title="Garment">
        <div className="grid gap-1.5">
          {catalog.garmentTypes.map((g) => (
            <Tile key={g} selected={specs.garmentType === g} onClick={() => update({ garmentType: g })} title={g} description={GARMENT_INFO[g]} icon={Shirt} />
          ))}
        </div>
      </Group>

      <Group title="Fabric colour" action={<span className="font-mono text-[11px] text-zinc-400">{specs.color.toUpperCase()}</span>}>
        <div className="flex flex-wrap gap-2">
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              aria-label={c.name}
              onClick={() => update({ color: c.hex })}
              className={cx(
                'h-8 w-8 rounded-full shadow-inner ring-1 ring-white/20 transition',
                specs.color.toUpperCase() === c.hex ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'
              )}
              style={{ backgroundColor: c.hex }}
            />
          ))}
          <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-zinc-950/60 pl-1 pr-2.5 text-xs text-zinc-400 ring-1 ring-white/10 hover:text-zinc-200" title="Custom colour">
            <input
              type="color"
              value={specs.color}
              onChange={(e) => update({ color: e.target.value.toUpperCase() }, { group: 'garment-color' })}
              className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
            />
            Custom
          </label>
        </div>
      </Group>

      <Group title="Fabric">
        <div className="grid gap-1.5">
          {catalog.fabrics.map((f) => (
            <Tile key={f} selected={specs.fabric === f} onClick={() => update({ fabric: f })} title={f} description={FABRIC_INFO[f]?.blurb} />
          ))}
        </div>
      </Group>

      <Group title="Weight (GSM)">
        <div className="grid grid-cols-4 gap-1.5">
          {catalog.gsmOptions.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => update({ gsm: g })}
              aria-pressed={specs.gsm === g}
              className={cx(
                'rounded-xl border px-1 py-2 text-center transition',
                specs.gsm === g ? 'border-brand-400/70 bg-brand-500/10 ring-1 ring-brand-400/40' : 'border-white/[0.07] bg-zinc-950/40 hover:border-white/15'
              )}
            >
              <span className="block font-mono text-sm font-bold text-zinc-100">{g}</span>
              <span className="block text-[10px] text-zinc-500">{GSM_HINT[g]}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Print method" hint="Vendors are matched on this capability (PERA participant lock).">
        <div className="grid gap-1.5">
          {catalog.printTypes.map((p) => (
            <Tile key={p} selected={specs.printType === p} onClick={() => update({ printType: p })} title={p} description={PRINT_TYPE_INFO[p]?.blurb} icon={PRINT_ICONS[p]} />
          ))}
        </div>
        {specs.printType === 'Sublimation' && specs.fabric === '100% Cotton' && (
          <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            Sublimation works best on polyester (Dry-Fit). On cotton, colours may look faded.
          </p>
        )}
      </Group>
    </div>
  );
}

/* ─────────────────────────── Right panel: Order tab ─────────────────────────── */

function SizeGrid({ sizes, value, onChange, total, moq }) {
  const set = (size, raw, group) => onChange({ ...value, [size]: Math.max(0, Math.min(10000, Number.parseInt(raw, 10) || 0)) }, group);
  const met = total >= moq;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1.5">
        {sizes.map((size) => (
          <div key={size} className="rounded-xl bg-zinc-950/60 p-1.5 text-center ring-1 ring-white/[0.06]">
            <label htmlFor={`size-${size}`} className="block text-[10px] font-bold tracking-wider text-zinc-500">
              {size}
            </label>
            <input
              id={`size-${size}`}
              type="number"
              inputMode="numeric"
              min="0"
              value={value[size] ?? 0}
              onChange={(e) => set(size, e.target.value, `size-${size}`)}
              className="mt-0.5 w-full rounded-md bg-transparent py-1 text-center font-mono text-sm font-semibold text-white focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
            <div className="mt-1 flex justify-center gap-1">
              <button type="button" onClick={() => set(size, (value[size] || 0) - 5)} className="rounded bg-zinc-800 p-0.5 text-zinc-400 hover:text-white" aria-label={`Remove 5 ${size}`}>
                <Minus className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => set(size, (value[size] || 0) + 5)} className="rounded bg-zinc-800 p-0.5 text-zinc-400 hover:text-white" aria-label={`Add 5 ${size}`}>
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SIZE_PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => onChange(p.values)} className="rounded-full bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-300 ring-1 ring-white/10 hover:text-white">
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => onChange(Object.fromEntries(sizes.map((s) => [s, 0])))} className="px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300">
          Clear
        </button>
      </div>
      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-zinc-400">
            Total <span className="font-mono text-base font-bold text-white">{total}</span> pcs
          </span>
          <span className={met ? 'text-emerald-300' : 'text-amber-300'}>{met ? 'Minimum order met' : `${moq - total} more to reach MOQ ${moq}`}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={cx('h-full rounded-full transition-all', met ? 'bg-emerald-400' : 'bg-amber-400')} style={{ width: `${Math.min(100, Math.round((total / moq) * 100))}%` }} />
        </div>
      </div>
    </div>
  );
}

function Eligibility({ loading, preview, error, directName, total, specs }) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-zinc-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking vendor eligibility…
      </p>
    );
  }
  if (error) return <p className="text-xs text-red-300">{error.message}</p>;
  if (!preview) return <p className="text-xs text-zinc-500">Complete the sizes and artwork to check which vendors can bid.</p>;
  if (preview.directVendor) {
    return preview.canLaunch ? (
      <p className="flex items-center gap-2 text-xs text-emerald-300">
        <Store className="h-3.5 w-3.5" /> <span><strong>{directName}</strong> can take this order.</span>
      </p>
    ) : (
      <div className="text-xs text-red-300">
        <p className="font-medium">{directName} can&apos;t take this order as configured:</p>
        <ul className="mt-1 list-disc pl-5">
          {preview.directVendor.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    );
  }
  return preview.canLaunch ? (
    <p className="flex items-center gap-2 text-xs text-emerald-300">
      <Users className="h-3.5 w-3.5" />
      <span>
        <strong>{preview.eligibleVendorCount}</strong> prequalified vendor{preview.eligibleVendorCount === 1 ? '' : 's'} can bid
      </span>
    </p>
  ) : (
    <p className="text-xs text-red-300">
      No prequalified vendor can fulfil {total} pcs of {specs.printType} right now. Try another print method or a smaller quantity.
    </p>
  );
}

/* ─────────────────────────────────── Page ─────────────────────────────────── */

const TOUR_KEY = 'customt_tour_studio_v1';
const VIEW_MODE_KEY = 'customt_studio_view';
const VIEW_MODES = [
  { value: '2d', label: '2D', icon: PenTool },
  { value: 'split', label: 'Split', icon: Columns2 },
  { value: '3d', label: '3D', icon: Box },
];

function loadViewMode() {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return VIEW_MODES.some((m) => m.value === v) ? v : 'split';
  } catch {
    return 'split';
  }
}

/** First-visit tour of the studio (6 steps). Targets are the data-tour attributes below. */
const TOUR_STEPS = [
  {
    title: 'Welcome to the design studio',
    icon: Sparkles,
    body: (
      <>
        <p>Design your garment here, then let verified printers compete for the order.</p>
        <p className="text-zinc-400">Your payment waits in escrow and is released only after you check the goods. This takes about 30 seconds.</p>
      </>
    ),
  },
  {
    target: 'pattern',
    title: 'Place your artwork',
    icon: Layers,
    body: (
      <>
        <p>The shirt is shown as its cut pieces. Click a piece (front, back or a sleeve), then add <strong className="text-white">Text</strong> or an <strong className="text-white">Image</strong> from the tools on the left.</p>
        <p className="text-zinc-400">Drag a layer to move it; the toolbar below rotates, centres or deletes it. Scroll to zoom. Prefer the whole shirt? Switch to <strong className="text-zinc-200">Garment</strong>.</p>
      </>
    ),
  },
  {
    target: 'viewer',
    title: 'Check it in 3D',
    icon: Move3d,
    body: (
      <>
        <p>Every change appears on the 3D model straight away. Drag to turn it, pinch or scroll to zoom.</p>
        <p className="text-zinc-400">Use Front, Back and Side to jump between views. Need more room? Switch between <strong className="text-zinc-200">2D</strong>, <strong className="text-zinc-200">Split</strong> and <strong className="text-zinc-200">3D</strong> in the top bar.</p>
      </>
    ),
  },
  {
    target: 'settings',
    title: 'Fine-tune the details',
    icon: SlidersHorizontal,
    body: (
      <>
        <p><strong className="text-white">Garment</strong>: type, colour, fabric, weight and print method.</p>
        <p><strong className="text-white">Artwork</strong>: the layer list, plus font, size, colour and rotation of the selected layer.</p>
        <p><strong className="text-white">Order</strong>: sizes, delivery and how many printers can bid.</p>
      </>
    ),
  },
  {
    target: 'history',
    title: 'Experiment freely',
    icon: Undo2,
    body: (
      <>
        <p>Undo and redo any change with these buttons or <span className="font-mono text-xs">Ctrl+Z</span> / <span className="font-mono text-xs">Ctrl+Shift+Z</span>.</p>
        <p className="text-zinc-400">Your design is saved in this browser as you work, so you can come back later.</p>
      </>
    ),
  },
  {
    target: 'launch',
    title: 'Launch and pay safely',
    icon: ShieldCheck,
    body: (
      <>
        <p>Launching opens a 24-hour auction: prequalified printers send their best price and delivery time.</p>
        <p className="text-zinc-400">You pay into escrow. 30% goes to the printer when production starts, the rest only after you inspect the goods and share your PIN.</p>
      </>
    ),
  },
];

const TABS = [
  { value: 'garment', label: 'Garment', icon: Shirt },
  { value: 'artwork', label: 'Artwork', icon: PenTool },
  { value: 'order', label: 'Order', icon: Rocket },
];

/**
 * CustomT Design Studio: three panes on wide screens (split view).
 *   left   = flat 2D pattern of one side + its layer stack (drag to place)
 *   centre = live 3D garment with a glass view toolbar and adaptive render quality
 *   right  = settings: Garment · Artwork (selected layer, incl. rotation) · Order (sizes, launch)
 * Below 1280px the panes stack (3D first). Every design change goes through an undo history.
 */
export default function Configurator() {
  const { catalog, loading: catalogLoading, error: catalogError, reload } = useCatalog();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const draft = useMemo(loadDraft, []);

  // ── Direct Quote: /create-rfq?vendorId=… sends the RFQ to one vendor only. ──
  const directVendorId = /^[a-f0-9]{24}$/i.test(searchParams.get('vendorId') || '') ? searchParams.get('vendorId') : null;
  const [directVendor, setDirectVendor] = useState(null);
  const [directVendorError, setDirectVendorError] = useState(null);
  useEffect(() => {
    setDirectVendor(null);
    setDirectVendorError(null);
    if (!directVendorId) return undefined;
    let cancelled = false;
    storefrontApi
      .get(directVendorId, { limit: 1 })
      .then((res) => !cancelled && setDirectVendor(res.vendor))
      .catch((err) => !cancelled && setDirectVendorError(err));
    return () => {
      cancelled = true;
    };
  }, [directVendorId]);
  const openToAllVendors = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('vendorId');
    setSearchParams(next, { replace: true });
  };
  const directName = directVendor?.companyName || directVendor?.name || 'this vendor';

  // ── Design state with undo/redo ──
  const history = useHistory(draft?.specs || DEFAULT_SPECS);
  const specs = history.value;
  const update = useCallback((patch, opts) => history.set((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }), opts), [history.set]); // eslint-disable-line react-hooks/exhaustive-deps
  useUndoShortcuts(history.undo, history.redo);

  const [title, setTitle] = useState(draft?.title || '');
  const [description, setDescription] = useState(draft?.description || '');
  const [deliveryOverride, setDeliveryOverride] = useState(draft?.deliveryOverride || '');
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [side, setSide] = useState('front');
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('garment');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [touched, setTouched] = useState(false);
  const tour = useFirstVisitTour(TOUR_KEY, { ready: Boolean(catalog) });
  const [viewMode, setViewModeState] = useState(loadViewMode);
  // Preview pane: the realistic photo preview (default, for garments that have photos) or the live 3D model.
  const [previewKind, setPreviewKind] = useState(() => {
    try {
      return localStorage.getItem('customt_preview_kind') === '3d' ? '3d' : 'photo';
    } catch {
      return 'photo';
    }
  });
  const choosePreview = (kind) => {
    setPreviewKind(kind);
    try {
      localStorage.setItem('customt_preview_kind', kind);
    } catch {
      /* ignore */
    }
  };
  const [units, setUnitsState] = useState(() => {
    try {
      return localStorage.getItem('customt_units') === 'in' ? 'in' : 'cm';
    } catch {
      return 'cm';
    }
  });
  const setUnits = (u) => {
    setUnitsState(u);
    try {
      localStorage.setItem('customt_units', u);
    } catch {
      /* ignore */
    }
  };
  const setViewMode = (mode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  };
  // The tour points at both views, so it always runs in split view.
  useEffect(() => {
    if (tour.open) setViewModeState('split');
  }, [tour.open]);

  const sizes = catalog?.sizes || ['S', 'M', 'L', 'XL', 'XXL'];
  const moq = catalog?.minOrderQuantity || 20;
  const total = sizes.reduce((sum, s) => sum + (Number(specs.sizeBreakdown[s]) || 0), 0);
  const minDays = estimateDeliveryDays(specs, total, catalog?.deliveryEstimation);
  const sidesPrinted = printedSides(specs);
  const hasArtwork = sidesPrinted.length > 0;
  const emptyText = specs.textLayers.some((l) => !l.text.trim());

  // A selection that undo/redo removed is dropped.
  useEffect(() => {
    if (selectedId && !allLayersOf(specs).some((l) => l.id === selectedId)) setSelectedId(null);
  }, [specs, selectedId]);

  /** Selecting a layer (on the pattern or in a list) also shows its side and opens the Artwork tab. */
  const selectLayer = useCallback(
    (id) => {
      setSelectedId(id);
      if (!id) return;
      setTab('artwork');
      const layer = allLayersOf(specs).find((l) => l.id === id);
      if (layer && layer.side !== side) setSide(layer.side);
    },
    [specs, side]
  );
  const moveLayer = useCallback(
    (id, pos) =>
      update(
        (s) => ({
          textLayers: s.textLayers.map((l) => (l.id === id ? { ...l, ...pos } : l)),
          imageLayers: s.imageLayers.map((l) => (l.id === id ? { ...l, ...pos } : l)),
        }),
        { group: `move:${id}` }
      ),
    [update]
  );
  const art = useArtwork({ specs, update, side, onSelect: selectLayer });

  // The 3D toolbar's Front/Back/Side also switches the 2D pattern to that side.
  const onViewChange = useCallback((v) => {
    if (v === 'front' || v === 'back') setSide(v);
    else if (v === 'side') setSide((s) => (s === 'leftSleeve' || s === 'rightSleeve' ? s : 'leftSleeve'));
  }, []);

  useEffect(() => {
    saveDraft({ specs, title, description, deliveryOverride });
  }, [specs, title, description, deliveryOverride]);

  // Live server-side diagnostic: PERA event-level lock (eligible vendor count).
  const debouncedSpecs = useDebouncedValue(specs, 600);

  // Live print check: image resolution at the real printed size, and artwork outside the print areas.
  const [printCheck, setPrintCheck] = useState({ issues: [], quality: {} });
  useEffect(() => {
    let cancelled = false;
    import('../../utils/productionPack')
      .then(({ checkPrintQuality }) => checkPrintQuality(debouncedSpecs))
      .then((result) => !cancelled && setPrintCheck(result))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debouncedSpecs]);
  useEffect(() => {
    let cancelled = false;
    const qty = sizes.reduce((sum, s) => sum + (Number(debouncedSpecs.sizeBreakdown[s]) || 0), 0);
    const artwork = printedSides(debouncedSpecs).length > 0 && debouncedSpecs.textLayers.every((l) => l.text.trim());
    if (!catalog || qty < moq || !artwork) {
      setPreview(null);
      setPreviewError(null);
      return undefined;
    }
    setPreviewLoading(true);
    rfqApi
      .preview(debouncedSpecs, directVendorId)
      .then((res) => {
        if (!cancelled) {
          setPreview(res.preview);
          setPreviewError(null);
        }
      })
      .catch((err) => !cancelled && setPreviewError(err))
      .finally(() => !cancelled && setPreviewLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSpecs, catalog, moq, directVendorId]);

  // A feed post can prefill garment, fabric and GSM (?garment=&fabric=&gsm=), applied once on arrival.
  useEffect(() => {
    if (prefillApplied || !catalog) return;
    setPrefillApplied(true);
    const patch = {};
    const garment = searchParams.get('garment');
    const fabric = searchParams.get('fabric');
    const gsm = Number(searchParams.get('gsm'));
    if (catalog.garmentTypes.includes(garment)) patch.garmentType = garment;
    if (catalog.fabrics.includes(fabric)) patch.fabric = fabric;
    if (catalog.gsmOptions.includes(gsm)) patch.gsm = gsm;
    if (Object.keys(patch).length) history.reset({ ...specs, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const deliveryDays = deliveryOverride === '' ? minDays : Number(deliveryOverride);
  const validation = [];
  if (title.trim().length < 3) validation.push('Give your RFQ a title (at least 3 characters).');
  if (total < moq) validation.push(`Order at least ${moq} pieces (currently ${total}).`);
  if (!hasArtwork) validation.push('Add text or an image to at least one side.');
  if (emptyText) validation.push('One of your text layers is empty. Type something or delete it.');
  if (deliveryOverride !== '' && (!Number.isInteger(deliveryDays) || deliveryDays < minDays)) validation.push(`Delivery must be at least ${minDays} days for this specification.`);
  if (preview && !preview.canLaunch) {
    validation.push(preview.directVendor ? `${directName} can't take this order: ${preview.directVendor.reasons.join('; ')}.` : 'No prequalified vendor can fulfil this order yet (PERA event lock).');
  }
  if (directVendorId && directVendorError) validation.push('The vendor for this Direct Quote is not available. Open the request to all vendors instead.');

  const openConfirm = () => {
    setTouched(true);
    setTab('order');
    if (validation.length === 0) {
      setSubmitError(null);
      setConfirmOpen(true);
    }
  };

  const launch = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await rfqApi.create({
        title: title.trim(),
        description: description.trim(),
        expectedDeliveryDays: deliveryOverride === '' ? undefined : deliveryDays,
        designSpecs: specs,
        ...(directVendorId ? { directVendorId } : {}),
      });
      clearDraft();
      toast.success(res.message, { title: 'Auction launched' });
      navigate(`/buyer/rfqs/${res.rfq._id}`);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const resetDesign = () => {
    update(DEFAULT_SPECS); // undoable
    setSelectedId(null);
    setSide('front');
    toast.info('Design reset. Press Ctrl+Z to bring it back.');
  };

  if (catalogLoading) return <PageLoader label="Loading the design studio…" />;
  if (catalogError) {
    return (
      <Alert tone="danger" title="Could not load the design studio">
        {catalogError.message}{' '}
        <button type="button" className="font-semibold underline" onClick={reload}>
          Retry
        </button>
      </Alert>
    );
  }

  const ready = validation.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-[1.25rem] bg-zinc-950 p-2 text-zinc-100 shadow-2xl ring-1 ring-black/5 sm:p-3 xl:h-[calc(100dvh-5.5rem)]">
      {/* ── Studio bar ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <div className="mr-auto flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-500/30">
            <Shirt className="h-4 w-4 text-white" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-white">{directVendorId ? 'Direct Quote studio' : 'Design studio'}</h1>
            <p className="truncate text-[11px] text-zinc-500">
              {specs.garmentType} · {specs.fabric} {specs.gsm} GSM · {specs.printType}
            </p>
          </div>
        </div>

        {directVendorId && (
          <span className={cx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1', directVendorError ? 'bg-red-500/10 text-red-300 ring-red-400/30' : 'bg-brand-500/10 text-brand-200 ring-brand-400/30')}>
            <Store className="h-3.5 w-3.5" />
            {directVendorError ? 'Vendor unavailable' : (
              <>
                Only{' '}
                <Link to={`/vendors/${directVendorId}`} className="font-semibold underline-offset-2 hover:underline">
                  {directName}
                </Link>{' '}
                will see this
              </>
            )}
            <button type="button" onClick={openToAllVendors} className="ml-1 rounded-full p-0.5 hover:bg-white/10" title="Open to all vendors instead" aria-label="Open to all vendors instead">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}

        <Segmented size="sm" label="Layout" value={viewMode} onChange={setViewMode} options={VIEW_MODES} className="order-last w-full sm:order-none sm:w-auto" />
        <StudioButton variant="ghost" icon={Compass} onClick={tour.start} className="px-2.5" title="Take the tour" aria-label="Take the tour">
          <span className="hidden sm:inline">Tour</span>
        </StudioButton>
        <div data-tour="history" className="flex items-center gap-0.5 rounded-xl bg-zinc-900 p-1 ring-1 ring-white/[0.07]">
          <IconButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={history.undo} disabled={!history.canUndo} />
          <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" onClick={history.redo} disabled={!history.canRedo} />
          <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden="true" />
          <IconButton icon={RotateCcw} label="Reset design" onClick={resetDesign} />
        </div>
        <StudioButton data-tour="launch" variant="primary" icon={Rocket} onClick={openConfirm}>
          {directVendorId ? 'Send request' : 'Launch auction'}
        </StudioButton>
      </div>

      {/* ── Panes: 2D editor | 3D (equal halves, or one of them full width) | settings ── */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(20rem,22rem)]">
        {viewMode !== '3d' && (
          <PatternEditor
            data-tour="pattern"
            className={cx('h-[30rem] sm:h-[36rem] xl:h-auto', viewMode === '2d' && 'lg:col-span-2')}
            specs={specs}
            side={side}
            onSideChange={setSide}
            selectedId={selectedId}
            onSelect={selectLayer}
            onLayerMove={moveLayer}
            art={art}
            units={units}
            onUnitsChange={setUnits}
          />
        )}

        {viewMode !== '2d' && (
          <Panel data-tour="viewer" className={cx('relative h-[22rem] sm:h-[30rem] lg:h-[36rem] xl:h-auto', viewMode === '3d' && 'lg:col-span-2')}>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(99,102,241,0.16),transparent_60%),radial-gradient(ellipse_at_50%_100%,rgba(255,255,255,0.05),transparent_50%)]" />
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading 3D viewer…
                </div>
              }
            >
              {previewKind === 'photo' && hasPhotoMockup(specs.garmentType) ? (
                <div className="relative flex h-full flex-col">
                  <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/15 bg-white/[0.07] p-1 shadow-2xl shadow-black/40 backdrop-blur-xl" role="toolbar" aria-label="Photo side">
                    {['front', 'back'].map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setSide(f)}
                        aria-pressed={(side === 'back' ? 'back' : 'front') === f}
                        className={cx(
                          'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                          (side === 'back' ? 'back' : 'front') === f ? 'bg-brand-500 text-white' : 'text-zinc-200 hover:bg-white/10'
                        )}
                      >
                        {f === 'front' ? 'Front' : 'Back'}
                      </button>
                    ))}
                  </div>
                  <PhotoMockupView
                    specs={specs}
                    face={side === 'back' ? 'back' : 'front'}
                    className="min-h-0 flex-1 px-4 pb-14 pt-16"
                    interactive
                    zoomable
                    selectedId={selectedId}
                    onSelect={selectLayer}
                    onLayerMove={moveLayer}
                  />
                  <p className="pointer-events-none absolute bottom-3 left-3 hidden max-w-[11rem] text-[11px] leading-snug text-zinc-500 xl:block">
                    Drag your prints on the photo. Scroll, pinch or double-click to zoom. Sleeve prints show in 3D.
                  </p>
                </div>
              ) : (
                <Shirt3DViewer specs={specs} variant="studio" height="100%" view={side} onViewChange={onViewChange} className="relative" />
              )}
            </Suspense>
            {hasPhotoMockup(specs.garmentType) && (
              <div className="absolute bottom-3 left-3 z-10 sm:left-1/2 sm:-translate-x-1/2">
                <Segmented
                  size="sm"
                  label="Preview"
                  value={previewKind}
                  onChange={choosePreview}
                  options={[
                    { value: '3d', label: '3D', icon: Box },
                    { value: 'photo', label: 'Photo', icon: Camera },
                  ]}
                />
              </div>
            )}
          </Panel>
        )}

        {/* Right: settings */}
        <Panel data-tour="settings" className="max-h-[44rem] lg:col-span-2 xl:col-span-1 xl:max-h-none">
          <PanelHeader icon={SlidersHorizontal} title="Design settings" />
          <div className="border-b border-white/[0.07] p-3">
            <Segmented label="Settings" value={tab} onChange={setTab} options={TABS} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'garment' && <GarmentTab catalog={catalog} specs={specs} update={update} />}
            {tab === 'artwork' && (
              <div className="space-y-5">
                <LayerList specs={specs} side={side} selectedId={selectedId} onSelect={selectLayer} art={art} />
                <div className="h-px bg-white/[0.07]" />
                <LayerInspector specs={specs} selectedId={selectedId} art={art} onSideChange={setSide} units={units} printCheck={printCheck} />
              </div>
            )}
            {tab === 'order' && (
              <div className="space-y-6">
                <Group title="Size breakdown" hint={`Minimum order quantity: ${moq} pieces.`}>
                  <SizeGrid sizes={sizes} value={specs.sizeBreakdown} onChange={(sizeBreakdown, group) => update({ sizeBreakdown }, { group })} total={total} moq={moq} />
                </Group>
                <Group title="RFQ details">
                  <label className="block">
                    <span className="mb-1 block text-xs text-zinc-400">Title *</span>
                    <input
                      value={title}
                      maxLength={120}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Annual staff polo shirts"
                      className={cx(studioInput, touched && title.trim().length < 3 && 'border-red-400/60')}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-zinc-400">Notes for vendors</span>
                    <textarea rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Packaging, Pantone references, delivery location…" className={studioInput} />
                  </label>
                  {/* Buyers think in dates ("needed by 15 December"); the RFQ stores delivery days. Days count from
                      the end of the 24-hour auction, so the date is today + 1 + days. */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-zinc-400">Needed by</span>
                      <input
                        type="date"
                        min={minDays ? dateAfterDays(minDays) : undefined}
                        value={deliveryDays ? dateAfterDays(deliveryDays) : ''}
                        onChange={(e) => {
                          const days = daysUntil(e.target.value);
                          if (days !== null) setDeliveryOverride(String(Math.max(1, days)));
                        }}
                        className={cx(studioInput, '[color-scheme:dark]')}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex items-center justify-between text-xs text-zinc-400">
                        Delivery (days)
                        {minDays ? <span className="text-zinc-500">min {minDays}</span> : null}
                      </span>
                      <span className="relative block">
                        <CalendarClock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                        <input type="number" min={minDays || 1} value={deliveryOverride} placeholder={minDays ? String(minDays) : ''} onChange={(e) => setDeliveryOverride(e.target.value)} className={cx(studioInput, 'pl-9')} />
                      </span>
                    </label>
                  </div>
                  <p className="-mt-1 text-[11px] text-zinc-500">Printers deliver within these days after the 24-hour auction closes.</p>
                </Group>
                <Group title="Print check" hint="Checked against the real print size. Fix these before launch for the best result; they don't block the launch.">
                  {printCheck.issues.length === 0 ? (
                    <p className="flex items-center gap-2 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200 ring-1 ring-emerald-400/20">
                      <CircleCheck className="h-3.5 w-3.5 shrink-0" /> Artwork is sharp and inside the print areas.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {printCheck.issues.map((issue) => (
                        <li key={`${issue.layerId}-${issue.message}`}>
                          <button
                            type="button"
                            onClick={() => selectLayer(issue.layerId)}
                            className={cx(
                              'flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-xs ring-1 transition hover:brightness-125',
                              issue.level === 'bad' ? 'bg-red-500/10 text-red-200 ring-red-400/25' : 'bg-amber-400/10 text-amber-100 ring-amber-400/20'
                            )}
                          >
                            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {issue.message}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Group>
                <Group title="Technical summary">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-zinc-950/60 p-3 text-xs ring-1 ring-white/[0.06]">
                    {[
                      ['Printed sides', sidesPrinted.length ? sidesPrinted.map((s) => SIDE_LABEL[s]).join(', ') : 'None yet'],
                      ['Quantity', `${total} pcs`],
                      ['Delivery', minDays ? `${deliveryDays ?? minDays} days` : '—'],
                      ['Base colour', specs.color.toUpperCase()],
                    ].map(([k, v]) => (
                      <div key={k} className="min-w-0">
                        <dt className="text-zinc-500">{k}</dt>
                        <dd className="truncate font-medium text-zinc-100">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-white/[0.06]">
                    <Eligibility loading={previewLoading} preview={preview} error={previewError} directName={directName} total={total} specs={specs} />
                  </div>
                </Group>
                {touched && validation.length > 0 && (
                  <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100">
                    <p className="mb-1 flex items-center gap-1.5 font-semibold">
                      <CircleAlert className="h-3.5 w-3.5" /> Before you launch
                    </p>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {validation.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] bg-zinc-900/90 px-4 py-3">
            <div className="min-w-0 text-xs">
              <p className="font-mono text-sm font-semibold text-white">{total} pcs</p>
              <p className={cx('flex items-center gap-1 truncate', ready ? 'text-emerald-300' : 'text-zinc-500')}>
                {ready ? <CircleCheck className="h-3 w-3" /> : null}
                {ready ? 'Ready to launch' : `${validation.length} item${validation.length === 1 ? '' : 's'} to finish`}
              </p>
            </div>
            <StudioButton variant="primary" icon={Rocket} onClick={openConfirm}>
              {directVendorId ? 'Send' : 'Launch'}
            </StudioButton>
          </div>
        </Panel>
      </div>

      <p className="hidden px-1 text-[11px] text-zinc-600 xl:block">
        <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> undo · <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd> redo · your design is saved in this browser as you work
      </p>

      {art.fileInput}

      <GuidedTour steps={TOUR_STEPS} open={tour.open} onClose={tour.close} label="Design studio tour" />

      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title={directVendorId ? `Send this request to ${directName}?` : 'Launch this auction?'}
        subtitle={title}
        dismissible={!submitting}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Keep editing
            </Button>
            <Button icon={Rocket} loading={submitting} onClick={launch}>
              {directVendorId ? 'Send request' : 'Launch auction'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="w-28 shrink-0 rounded-xl bg-slate-50 p-2">
              <TShirtPreview specs={specs} view={sidesPrinted[0] === 'back' ? 'back' : 'front'} />
            </div>
            <ul className="space-y-1 text-sm text-slate-700">
              <li>
                <strong>{total} pcs</strong> {specs.garmentType}, {specs.fabric} {specs.gsm} GSM
              </li>
              <li>
                {specs.printType} · {sidesPrinted.map((s) => SIDE_LABEL[s]).join(', ')}
              </li>
              <li>Delivery within {deliveryDays} days</li>
              {preview && <li>{preview.directVendor ? `Only ${directName} will be notified and can quote` : `${preview.eligibleVendorCount} prequalified vendor(s) will be notified instantly`}</li>}
            </ul>
          </div>
          <Alert tone="info" icon={Lock} title="Your design will be locked">
            To protect vendors from post-order changes (CPAPO), the specification cannot be edited once bidding opens. If you need changes later, cancel the RFQ and launch a new one.
          </Alert>
          <ErrorList error={submitError} />
        </div>
      </Modal>
    </div>
  );
}
