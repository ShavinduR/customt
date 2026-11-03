import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  CalendarClock,
  Droplets,
  FileText,
  Layers,
  Lock,
  Move,
  Palette,
  Rocket,
  Ruler,
  Scissors,
  ShieldCheck,
  Shirt,
  Sparkles,
  Type,
  Users,
} from 'lucide-react';
import { rfqApi } from '../../api/client';
import { useCatalog } from '../../context/CatalogContext';
import { useToast } from '../../context/ToastContext';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import TShirtPreview from '../../components/configurator/TShirtPreview';
import SizeMatrix from '../../components/configurator/SizeMatrix';
import OptionCard from '../../components/configurator/OptionCard';
import LogoUploader from '../../components/configurator/LogoUploader';
import { Alert, Button, Card, ErrorList, Field, Input, Modal, PageHeader, PageLoader, Spinner, Textarea, cx } from '../../components/ui';
import { COLOR_SWATCHES, FABRIC_INFO, GARMENT_INFO, PRINT_TYPE_INFO } from '../../utils/status';

const DRAFT_KEY = 'customt_rfq_draft_v1';
const PRINT_ICONS = { 'Screen Printing': Layers, DTF: Sparkles, Embroidery: Scissors, Sublimation: Droplets };
const GSM_HINT = { 160: 'Light', 180: 'Standard', 200: 'Heavy', 220: 'Premium' };
const PLACEMENT_LABEL = { FRONT: 'Front only', BACK: 'Back only', FRONT_AND_BACK: 'Front & back' };
const TEXT_SWATCHES = ['#FFFFFF', '#111827', '#DC2626', '#F59E0B', '#2563EB', '#15803D', '#D4AF37'];

const DEFAULT_SPECS = {
  garmentType: 'Crew Neck',
  fabric: '100% Cotton',
  gsm: 180,
  color: '#1E3A8A',
  printType: 'Screen Printing',
  printPlacement: 'FRONT',
  customText: 'CUSTOMT EVENT 2026',
  backText: '',
  textColor: '#FFFFFF',
  logoUrl: '',
  designPosition: { x: 50, y: 30, scale: 1 },
  sizeBreakdown: { S: 10, M: 20, L: 20, XL: 10, XXL: 5 },
};

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
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

/** Mirrors the backend estimator so the buyer sees delivery days instantly. */
function estimateDeliveryDays(specs, total, estimation) {
  if (!estimation) return null;
  const base = estimation.basePrintDays[specs.printType] ?? 7;
  const garment = estimation.garmentExtraDays[specs.garmentType] ?? 0;
  const volume = Math.max(0, Math.ceil(total / estimation.piecesPerExtraDay) - 1);
  const sides = specs.printPlacement === 'FRONT_AND_BACK' ? estimation.bothSidesExtraDays : 0;
  return base + garment + volume + sides;
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
  const hasArtwork = Boolean(specs.customText.trim() || specs.backText.trim() || specs.logoUrl);

  useEffect(() => {
    saveDraft({ specs, title, description, deliveryOverride });
  }, [specs, title, description, deliveryOverride]);

  // Show the side that actually carries artwork.
  useEffect(() => {
    if (specs.printPlacement === 'BACK') setView('back');
    if (specs.printPlacement === 'FRONT') setView('front');
  }, [specs.printPlacement]);

  // Live server-side diagnostic: PERA event-level lock (eligible vendor count).
  const debouncedSpecs = useDebouncedValue(specs, 600);
  useEffect(() => {
    let cancelled = false;
    const qty = sizes.reduce((sum, s) => sum + (Number(debouncedSpecs.sizeBreakdown[s]) || 0), 0);
    const artwork = debouncedSpecs.customText.trim() || debouncedSpecs.backText.trim() || debouncedSpecs.logoUrl;
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
  if (!hasArtwork) validation.push('Add custom text or upload a logo.');
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
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex rounded-lg bg-slate-100 p-1">
                {['front', 'back'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={cx('rounded-md px-3 py-1 text-sm font-medium capitalize', view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Move className="h-3.5 w-3.5" /> Drag artwork to position
              </span>
            </div>
            <div className="checkerboard px-6 py-4 sm:px-12">
              <TShirtPreview specs={specs} view={view} editable onPositionChange={(designPosition) => update({ designPosition })} showPrintArea />
            </div>
            <div className="border-t border-slate-100 px-4 py-3">
              <label htmlFor="scale" className="flex items-center justify-between text-xs font-medium text-slate-600">
                Artwork size <span className="font-mono">{Math.round((specs.designPosition.scale || 1) * 100)}%</span>
              </label>
              <input
                id="scale"
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={specs.designPosition.scale || 1}
                onChange={(e) => update({ designPosition: { ...specs.designPosition, scale: Number(e.target.value) } })}
                className="mt-1 w-full accent-brand-600"
              />
            </div>
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
                ['Print', `${specs.printType} · ${PLACEMENT_LABEL[specs.printPlacement]}`],
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

          <Section step="4" title="Print method & placement" icon={Sparkles} subtitle="Vendors are matched on this capability (PERA participant lock).">
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
            <p className="mb-2 mt-4 text-sm font-medium text-slate-700">Placement</p>
            <div className="grid grid-cols-3 gap-2">
              {catalog.printPlacements.map((p) => (
                <OptionCard key={p} compact selected={specs.printPlacement === p} onClick={() => update({ printPlacement: p })} title={PLACEMENT_LABEL[p]} />
              ))}
            </div>
          </Section>

          <Section step="5" title="Artwork" icon={Type}>
            <div className="space-y-4">
              <Field label={specs.printPlacement === 'BACK' ? 'Print text' : 'Front text'} hint={`${specs.customText.length}/120 characters`}>
                <Input value={specs.customText} maxLength={120} onChange={(e) => update({ customText: e.target.value })} placeholder="e.g. COLOMBO MARATHON 2026" />
              </Field>
              {specs.printPlacement === 'FRONT_AND_BACK' && (
                <Field label="Back text" hint="Printed large across the back">
                  <Input value={specs.backText} maxLength={120} onChange={(e) => update({ backText: e.target.value })} placeholder="e.g. VOLUNTEER" />
                </Field>
              )}
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Text / thread colour</p>
                <div className="flex flex-wrap items-center gap-2">
                  {TEXT_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      aria-label={`Text colour ${hex}`}
                      onClick={() => update({ textColor: hex })}
                      className={cx('h-7 w-7 rounded-full border border-slate-300', specs.textColor.toUpperCase() === hex ? 'ring-2 ring-brand-500 ring-offset-2' : '')}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                  <input type="color" value={specs.textColor} onChange={(e) => update({ textColor: e.target.value.toUpperCase() })} className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5" aria-label="Custom text colour" />
                </div>
              </div>
              <Field label="Logo">
                <LogoUploader value={specs.logoUrl} onChange={(logoUrl) => update({ logoUrl })} />
              </Field>
              {specs.printPlacement === 'FRONT_AND_BACK' && (
                <button type="button" onClick={() => setView(view === 'front' ? 'back' : 'front')} className="flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
                  <ArrowLeftRight className="h-4 w-4" /> Show {view === 'front' ? 'back' : 'front'} side
                </button>
              )}
            </div>
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
              <TShirtPreview specs={specs} view={specs.printPlacement === 'BACK' ? 'back' : 'front'} />
            </div>
            <ul className="space-y-1 text-sm text-slate-700">
              <li>
                <strong>{total} pcs</strong> {specs.garmentType}, {specs.fabric} {specs.gsm} GSM
              </li>
              <li>
                {specs.printType} · {PLACEMENT_LABEL[specs.printPlacement]}
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
