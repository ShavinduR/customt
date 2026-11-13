import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  CalendarClock,
  Droplets,
  FileText,
  Layers,
  Lock,
  Move,
  PenTool,
  Palette,
  Rocket,
  Ruler,
  Scissors,
  ShieldCheck,
  Shirt,
  Sparkles,
  Users,
} from 'lucide-react';
import { rfqApi } from '../../api/client';
import { useCatalog } from '../../context/CatalogContext';
import { useToast } from '../../context/ToastContext';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import TShirtPreview from '../../components/configurator/TShirtPreview';
import SizeMatrix from '../../components/configurator/SizeMatrix';
import OptionCard from '../../components/configurator/OptionCard';
import ArtworkEditor from '../../components/configurator/ArtworkEditor';
import { Alert, Button, Card, ErrorList, Field, Input, Modal, PageHeader, PageLoader, Spinner, Textarea, cx } from '../../components/ui';
import { COLOR_SWATCHES, FABRIC_INFO, GARMENT_INFO, PRINT_TYPE_INFO } from '../../utils/status';
import { SIDES, SIDE_LABEL } from '../../utils/garmentGeometry';
import { estimateDeliveryDays, layersOf, printedSides } from '../../utils/design';

const Shirt3DViewer = lazy(() => import('../../components/configurator/Shirt3DViewer'));

const DRAFT_KEY = 'customt_rfq_draft_v2';
const LEGACY_DRAFT_KEY = 'customt_rfq_draft_v1';
const PRINT_ICONS = { 'Screen Printing': Layers, DTF: Sparkles, Embroidery: Scissors, Sublimation: Droplets };
const GSM_HINT = { 160: 'Light', 180: 'Standard', 200: 'Heavy', 220: 'Premium' };

const DEFAULT_SPECS = {
  garmentType: 'Crew Neck',
  fabric: '100% Cotton',
  gsm: 180,
  color: '#1E3A8A',
  printType: 'Screen Printing',
  textLayers: [
    { id: 'tfront', side: 'front', text: 'CUSTOMT EVENT 2026', font: 'Bebas Neue', size: 28, color: '#FFFFFF', x: 50, y: 30 },
    { id: 'tback', side: 'back', text: 'CREW', font: 'Montserrat', size: 40, color: '#FFFFFF', x: 50, y: 25 },
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

function Section({ step, title, icon: Icon, children, subtitle }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{step}</span>
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            {Icon && <Icon className="h-4 w-4 text-slate-400" />}
            {title}
          </h2>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

export default function CreateRFQ() {
  const { catalog, loading: catalogLoading, error: catalogError, reload } = useCatalog();
  const toast = useToast();
  const navigate = useNavigate();
  const draft = useMemo(loadDraft, []);

  const [specs, setSpecs] = useState(draft?.specs || DEFAULT_SPECS);
  const [title, setTitle] = useState(draft?.title || '');
  const [description, setDescription] = useState(draft?.description || '');
  const [deliveryOverride, setDeliveryOverride] = useState(draft?.deliveryOverride || '');
  const [view, setView] = useState('front');
  const [mode3d, setMode3d] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [touched, setTouched] = useState(false);

  const update = (patch) => setSpecs((s) => ({ ...s, ...patch }));
  const sizes = catalog?.sizes || ['S', 'M', 'L', 'XL', 'XXL'];
  const moq = catalog?.minOrderQuantity || 20;
  const total = sizes.reduce((sum, s) => sum + (Number(specs.sizeBreakdown[s]) || 0), 0);
  const minDays = estimateDeliveryDays(specs, total, catalog?.deliveryEstimation);
  const sidesPrinted = printedSides(specs);
  const hasArtwork = sidesPrinted.length > 0;
  const emptyText = specs.textLayers.some((l) => !l.text.trim());
  const moveLayer = useCallback(
    (id, pos) =>
      setSpecs((s) => ({
        ...s,
        textLayers: s.textLayers.map((l) => (l.id === id ? { ...l, ...pos } : l)),
        imageLayers: s.imageLayers.map((l) => (l.id === id ? { ...l, ...pos } : l)),
      })),
    []
  );
  /** Selecting a layer (on the garment or in the list) also switches to the side it is printed on. */
  const selectLayer = (id) => {
    setSelectedId(id);
    const layer = [...specs.textLayers, ...specs.imageLayers].find((l) => l.id === id);
    if (layer && layer.side !== view) setView(layer.side);
  };
  const showSide = (side) => {
    setView(side);
    setMode3d(false);
  };

  useEffect(() => {
    saveDraft({ specs, title, description, deliveryOverride });
  }, [specs, title, description, deliveryOverride]);

  // Live server-side diagnostic: PERA event-level lock (eligible vendor count).
  const debouncedSpecs = useDebouncedValue(specs, 600);
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
      .preview(debouncedSpecs)
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
  }, [debouncedSpecs, catalog, moq]);

  const deliveryDays = deliveryOverride === '' ? minDays : Number(deliveryOverride);
  const validation = [];
  if (title.trim().length < 3) validation.push('Give your RFQ a title (at least 3 characters).');
  if (total < moq) validation.push(`Order at least ${moq} pieces (currently ${total}).`);
  if (!hasArtwork) validation.push('Add text or an image to at least one side.');
  if (emptyText) validation.push('One of your text layers is empty. Type something or delete it.');
  if (deliveryOverride !== '' && (!Number.isInteger(deliveryDays) || deliveryDays < minDays)) validation.push(`Delivery must be at least ${minDays} days for this specification.`);
  if (preview && !preview.canLaunch) validation.push('No prequalified vendor can fulfil this order yet (PERA event lock).');

  const openConfirm = () => {
    setTouched(true);
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

  if (catalogLoading) return <PageLoader label="Loading configurator…" />;
  if (catalogError) {
    return (
      <Alert tone="danger" title="Could not load the configurator">
        {catalogError.message}{' '}
        <button type="button" className="font-semibold underline" onClick={reload}>
          Retry
        </button>
      </Alert>
    );
  }

  return (
    <div>
      <PageHeader
        title="Design & launch an RFQ"
        subtitle="Configure your garment visually. We turn it into a technical specification and open a 24-hour reverse auction to prequalified printers."
        actions={
          <Button
            variant="ghost"
            onClick={() => {
              setSpecs(DEFAULT_SPECS);
              setSelectedId(null);
              setView('front');
              setTitle('');
              setDescription('');
              setDeliveryOverride('');
              clearDraft();
            }}
          >
            Reset design
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* ── Live preview ── */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex flex-wrap rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Garment view">
                {SIDES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={!mode3d && view === v}
                    onClick={() => showSide(v)}
                    className={cx('rounded-md px-2.5 py-1 text-sm font-medium', !mode3d && view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
                  >
                    {SIDE_LABEL[v]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setMode3d((m) => !m)}
                aria-pressed={mode3d}
                className={cx(
                  'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition',
                  mode3d ? 'border-brand-600 bg-brand-600 text-white' : 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'
                )}
              >
                {mode3d ? <PenTool className="h-4 w-4" /> : <Box className="h-4 w-4" />}
                {mode3d ? 'Back to editing' : 'View in 3D'}
              </button>
            </div>
            {mode3d ? (
              <Suspense fallback={<div className="flex h-[26rem] items-center justify-center"><Spinner label="Loading 3D viewer…" /></div>}>
                <Shirt3DViewer specs={specs} className="bg-gradient-to-b from-slate-50 to-slate-200" />
              </Suspense>
            ) : (
              <>
                <div className="checkerboard px-6 py-4 sm:px-12">
                  <TShirtPreview specs={specs} view={view} editable selectedId={selectedId} onSelect={selectLayer} onLayerMove={moveLayer} showPrintArea />
                </div>
                <p className="flex items-center justify-center gap-1 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                  <Move className="h-3.5 w-3.5" /> Click a layer to select it, drag to position. The dashed box is the printable area.
                </p>
              </>
            )}
          </Card>

          <Card className="mt-4 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileText className="h-4 w-4 text-slate-400" /> Technical RFQ preview
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ['Garment', specs.garmentType],
                ['Fabric', `${specs.fabric}, ${specs.gsm} GSM`],
                ['Base colour', specs.color],
                ['Print', specs.printType],
                ['Printed sides', sidesPrinted.length ? sidesPrinted.map((side) => SIDE_LABEL[side]).join(', ') : 'None yet'],
                ['Quantity', `${total} pcs`],
                ['Delivery', minDays ? `${deliveryDays ?? minDays} days` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="truncate font-medium text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              {previewLoading ? (
                <Spinner label="Checking vendor eligibility…" className="justify-start" />
              ) : preview ? (
                preview.canLaunch ? (
                  <p className="flex items-center gap-2 text-sm text-emerald-700">
                    <Users className="h-4 w-4" />
                    <span>
                      <strong>{preview.eligibleVendorCount}</strong> prequalified vendor{preview.eligibleVendorCount === 1 ? '' : 's'} can bid on this order
                    </span>
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-red-700">
                    <ShieldCheck className="h-4 w-4" />
                    No prequalified vendor can fulfil {total} pcs of {specs.printType} right now. Try a different print type or a smaller quantity.
                  </p>
                )
              ) : previewError ? (
                <p className="text-sm text-red-700">{previewError.message}</p>
              ) : (
                <p className="text-sm text-slate-500">Complete the size matrix and artwork to check vendor eligibility.</p>
              )}
            </div>
          </Card>
        </div>

        {/* ── Configuration steps ── */}
        <div className="space-y-4">
          <Section step="1" title="Garment" icon={Shirt}>
            <div className="grid gap-2 sm:grid-cols-3">
              {catalog.garmentTypes.map((g) => (
                <OptionCard key={g} compact selected={specs.garmentType === g} onClick={() => update({ garmentType: g })} title={g} description={GARMENT_INFO[g]} icon={Shirt} />
              ))}
            </div>
          </Section>

          <Section step="2" title="Fabric & weight" icon={Layers}>
            <div className="grid gap-2 sm:grid-cols-3">
              {catalog.fabrics.map((f) => (
                <OptionCard key={f} compact selected={specs.fabric === f} onClick={() => update({ fabric: f })} title={f} description={FABRIC_INFO[f]?.blurb} />
              ))}
            </div>
            <p className="mb-2 mt-4 text-sm font-medium text-slate-700">Fabric weight (GSM)</p>
            <div className="grid grid-cols-4 gap-2">
              {catalog.gsmOptions.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => update({ gsm: g })}
                  className={cx(
                    'rounded-xl border px-2 py-2 text-center transition',
                    specs.gsm === g ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 hover:bg-slate-50'
                  )}
                >
                  <span className="block font-mono font-bold text-slate-900">{g}</span>
                  <span className="block text-xs text-slate-500">{GSM_HINT[g]}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section step="3" title="Base colour" icon={Palette}>
            <div className="flex flex-wrap gap-2">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={c.name}
                  aria-label={c.name}
                  onClick={() => update({ color: c.hex })}
                  className={cx('h-9 w-9 rounded-full border border-slate-300 shadow-inner transition', specs.color.toUpperCase() === c.hex ? 'ring-2 ring-brand-500 ring-offset-2' : 'hover:scale-110')}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
              <label className="flex h-9 items-center gap-2 rounded-full border border-slate-300 pl-1 pr-3 text-sm text-slate-600">
                <input type="color" value={specs.color} onChange={(e) => update({ color: e.target.value.toUpperCase() })} className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0" />
                <span className="font-mono text-xs">{specs.color.toUpperCase()}</span>
              </label>
            </div>
          </Section>

          <Section step="4" title="Print method" icon={Sparkles} subtitle="Vendors are matched on this capability (PERA participant lock).">
            <div className="grid gap-2 sm:grid-cols-2">
              {catalog.printTypes.map((p) => (
                <OptionCard key={p} selected={specs.printType === p} onClick={() => update({ printType: p })} title={p} description={PRINT_TYPE_INFO[p]?.blurb} icon={PRINT_ICONS[p]} />
              ))}
            </div>
            {specs.printType === 'Sublimation' && specs.fabric === '100% Cotton' && (
              <Alert tone="warning" className="mt-3">
                Sublimation works best on polyester (Dry-Fit). On cotton, colours may look faded. Consider switching fabric or print method.
              </Alert>
            )}
          </Section>

          <Section step="5" title="Artwork" icon={PenTool} subtitle="Add text and images to the front, back and sleeves. Each extra printed side adds one production day.">
            <ArtworkEditor
              specs={specs}
              side={view}
              onSideChange={showSide}
              selectedId={selectedId}
              onSelect={(id) => {
                selectLayer(id);
                if (id) setMode3d(false);
              }}
              onChange={update}
            />
          </Section>

          <Section step="6" title="Size breakdown" icon={Ruler} subtitle={`Minimum order quantity: ${moq} pieces`}>
            <SizeMatrix sizes={sizes} value={specs.sizeBreakdown} onChange={(sizeBreakdown) => update({ sizeBreakdown })} total={total} moq={moq} />
          </Section>

          <Section step="7" title="Review & launch" icon={Rocket}>
            <div className="space-y-4">
              <Field label="RFQ title" required error={touched && title.trim().length < 3 ? 'Title is required' : null}>
                <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual staff polo shirts" invalid={touched && title.trim().length < 3} />
              </Field>
              <Field label="Notes for vendors" hint="Optional: packaging, Pantone references, delivery location…">
                <Textarea rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Field
                label="Expected delivery (days)"
                hint={minDays ? `Calculated automatically: ${minDays} days minimum for this specification. Leave blank to use it.` : undefined}
              >
                <Input icon={CalendarClock} type="number" min={minDays || 1} value={deliveryOverride} placeholder={minDays ? String(minDays) : ''} onChange={(e) => setDeliveryOverride(e.target.value)} />
              </Field>

              {touched && validation.length > 0 && (
                <Alert tone="warning" title="Before you launch">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {validation.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              <Button size="lg" className="w-full" icon={Rocket} onClick={openConfirm}>
                Launch 24-hour reverse auction
              </Button>
            </div>
          </Section>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="Launch this auction?"
        subtitle={title}
        dismissible={!submitting}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Keep editing
            </Button>
            <Button icon={Rocket} loading={submitting} onClick={launch}>
              Launch auction
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
                {specs.printType} · {sidesPrinted.map((side) => SIDE_LABEL[side]).join(', ')}
              </li>
              <li>Delivery within {deliveryDays} days</li>
              {preview && <li>{preview.eligibleVendorCount} prequalified vendor(s) will be notified instantly</li>}
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
