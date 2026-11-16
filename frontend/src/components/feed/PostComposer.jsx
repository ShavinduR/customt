import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Send, ShieldAlert, X } from 'lucide-react';
import { postApi, uploadApi } from '../../api/client';
import { useCatalog } from '../../context/CatalogContext';
import { useToast } from '../../context/ToastContext';
import { Alert, Button, ErrorList, Field, Input, Modal, Select, Textarea, cx } from '../ui';
import { POST_TYPES, POST_TYPE_META } from '../../utils/posts';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_MB = 2;
const EMPTY_ROW = { chestCm: '', lengthCm: '', sleeveCm: '' };

function initialState(type = 'PREMIUM_CATALOG') {
  return {
    postType: type,
    title: '',
    postDescription: '',
    images: [],
    garmentType: '',
    printTypes: [],
    fabric: '',
    gsm: '',
    composition: '',
    sizeRows: {},
    availableQuantity: '',
    unitPrice: '',
  };
}

/** Client-side mirror of the server rules, so vendors see problems before submitting. */
function validate(form, limits) {
  const problems = [];
  if (form.title.trim().length < (limits?.TITLE_MIN || 3)) problems.push('Give the post a title (at least 3 characters).');
  if (form.images.length === 0) problems.push('Add at least one photo.');
  const needsGarment = form.postType !== 'INSPIRATION';
  if (needsGarment && !form.garmentType) problems.push('Choose the garment type.');
  if (form.postType === 'PREMIUM_CATALOG') {
    if (!form.fabric || !form.gsm) problems.push('Premium Catalog posts need fabric specs (fabric and GSM).');
    const rows = Object.entries(form.sizeRows);
    if (rows.length === 0) problems.push('Premium Catalog posts need a size chart: tick at least one size.');
    rows.forEach(([size, r]) => {
      if (!(Number(r.chestCm) > 0) || !(Number(r.lengthCm) > 0)) problems.push(`Size ${size}: enter chest and length in cm.`);
    });
  }
  if (form.postType === 'CLEARANCE') {
    if (!(Number(form.availableQuantity) >= 1)) problems.push('Enter how many pieces are available.');
    if (!(Number(form.unitPrice) >= 1)) problems.push('Enter a guide price per piece.');
  }
  return problems;
}

function toPayload(form) {
  const payload = {
    postType: form.postType,
    title: form.title.trim(),
    postDescription: form.postDescription.trim(),
    images: form.images,
    printTypes: form.printTypes,
  };
  if (form.garmentType) payload.garmentType = form.garmentType;
  if (form.postType === 'PREMIUM_CATALOG') {
    payload.fabricSpecs = { fabric: form.fabric, gsm: Number(form.gsm), composition: form.composition.trim() };
    payload.sizeChart = Object.entries(form.sizeRows).map(([size, r]) => ({
      size,
      chestCm: Number(r.chestCm),
      lengthCm: Number(r.lengthCm),
      ...(r.sleeveCm === '' ? {} : { sleeveCm: Number(r.sleeveCm) }),
    }));
  }
  if (form.postType === 'CLEARANCE') {
    payload.clearance = { availableQuantity: Number(form.availableQuantity), unitPrice: Number(form.unitPrice) };
  }
  return payload;
}

/** Modal form a verified vendor uses to publish a post to the Global Feed and their storefront. */
export default function PostComposer({ open, onClose, onCreated, defaultType }) {
  const { catalog } = useCatalog();
  const toast = useToast();
  const fileRef = useRef(null);
  const [form, setForm] = useState(() => initialState(defaultType));
  const [uploading, setUploading] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);

  const limits = catalog?.posts;
  const maxImages = limits?.MAX_IMAGES || 6;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const problems = validate(form, limits);

  const close = () => {
    if (submitting) return;
    setForm(initialState(defaultType));
    setError(null);
    setTouched(false);
    onClose();
  };

  const addPhotos = async (fileList) => {
    const files = [...(fileList || [])];
    if (fileRef.current) fileRef.current.value = '';
    const room = maxImages - form.images.length;
    if (files.length > room) toast.info(`Only ${room} more photo(s) fit (maximum ${maxImages}).`);
    for (const file of files.slice(0, Math.max(0, room))) {
      if (!ACCEPT.includes(file.type)) {
        toast.error(`${file.name}: use a PNG, JPG or WEBP photo.`);
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        toast.error(`${file.name} is larger than ${MAX_MB} MB.`);
        continue;
      }
      setUploading({ name: file.name, progress: 0 });
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await uploadApi.logo(file, (progress) => setUploading({ name: file.name, progress }));
        setForm((f) => ({ ...f, images: [...f.images, res.url].slice(0, maxImages) }));
      } catch (err) {
        toast.error(`${file.name}: ${err.message}`);
      }
    }
    setUploading(null);
  };

  const toggleSize = (size) =>
    setForm((f) => {
      const rows = { ...f.sizeRows };
      if (rows[size]) delete rows[size];
      else rows[size] = { ...EMPTY_ROW };
      return { ...f, sizeRows: rows };
    });
  const setRow = (size, patch) => setForm((f) => ({ ...f, sizeRows: { ...f.sizeRows, [size]: { ...f.sizeRows[size], ...patch } } }));

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (problems.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await postApi.create(toPayload(form));
      if (res.blocked?.length) toast.warning(res.message, { title: 'Contact details removed' });
      else toast.success(res.message);
      onCreated?.(res.post);
      setForm(initialState(defaultType));
      setTouched(false);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const sizes = catalog?.sizes || ['S', 'M', 'L', 'XL', 'XXL'];

  return (
    <Modal
      open={open}
      onClose={close}
      title="New post"
      subtitle="Shown in the buyers' Global Feed and on your storefront."
      size="lg"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="post-composer" icon={Send} loading={submitting} disabled={Boolean(uploading)}>
            Publish
          </Button>
        </>
      }
    >
      <form id="post-composer" onSubmit={submit} className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Post type">
          {POST_TYPES.map((t) => {
            const meta = POST_TYPE_META[t];
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.postType === t}
                onClick={() => set({ postType: t })}
                className={cx(
                  'rounded-xl border p-3 text-left transition',
                  form.postType === t ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 hover:bg-slate-50'
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <meta.icon className="h-4 w-4 text-brand-600" /> {meta.label}
                </span>
                <span className="mt-1 block text-xs text-slate-500">{meta.blurb}</span>
              </button>
            );
          })}
        </div>

        <Field label="Title" required>
          <Input value={form.title} maxLength={limits?.TITLE_MAX || 100} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. 220 GSM heavyweight crew neck" />
        </Field>
        <Field label="Description" hint={`${form.postDescription.length}/${limits?.DESCRIPTION_MAX || 1000}`}>
          <Textarea rows={3} maxLength={limits?.DESCRIPTION_MAX || 1000} value={form.postDescription} onChange={(e) => set({ postDescription: e.target.value })} />
        </Field>
        <Alert tone="info" icon={ShieldAlert}>
          Phone numbers, e-mails, links and messaging apps are removed automatically. Buyers reach you with a Direct Quote, which is protected by escrow.
        </Alert>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            Photos <span className="font-normal text-slate-400">({form.images.length}/{maxImages})</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {form.images.map((url, i) => (
              <div key={url} className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200">
                <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => set({ images: form.images.filter((u) => u !== url) })}
                  className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-slate-700 shadow hover:text-red-600"
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {form.images.length < maxImages && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={Boolean(uploading)}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-400 hover:text-brand-700"
              >
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                {uploading ? `${uploading.progress}%` : 'Add'}
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" multiple accept={ACCEPT.join(',')} className="hidden" onChange={(e) => addPhotos(e.target.files)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Garment type" required={form.postType !== 'INSPIRATION'}>
            <Select value={form.garmentType} onChange={(e) => set({ garmentType: e.target.value })}>
              <option value="">{form.postType === 'INSPIRATION' ? 'Any / not specific' : 'Choose…'}</option>
              {(catalog?.garmentTypes || []).map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Print methods shown</p>
            <div className="flex flex-wrap gap-1.5">
              {(catalog?.printTypes || []).map((p) => {
                const on = form.printTypes.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ printTypes: on ? form.printTypes.filter((x) => x !== p) : [...form.printTypes, p] })}
                    className={cx('rounded-full border px-2.5 py-1 text-xs font-medium', on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {form.postType === 'PREMIUM_CATALOG' && (
          <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
            <p className="text-sm font-semibold text-slate-900">Fabric specs and size chart (required for Premium Catalog)</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Fabric" required>
                <Select value={form.fabric} onChange={(e) => set({ fabric: e.target.value })}>
                  <option value="">Choose…</option>
                  {(catalog?.fabrics || []).map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </Select>
              </Field>
              <Field label="GSM" required>
                <Select value={form.gsm} onChange={(e) => set({ gsm: e.target.value })}>
                  <option value="">Choose…</option>
                  {(catalog?.gsmOptions || []).map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Composition">
                <Input value={form.composition} maxLength={limits?.COMPOSITION_MAX || 120} onChange={(e) => set({ composition: e.target.value })} placeholder="e.g. 100% combed cotton" />
              </Field>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-1 text-left font-medium">Size</th>
                    <th className="py-1 font-medium">Chest (cm)</th>
                    <th className="py-1 font-medium">Length (cm)</th>
                    <th className="py-1 font-medium">Sleeve (cm, optional)</th>
                  </tr>
                </thead>
                <tbody>
                  {sizes.map((size) => {
                    const row = form.sizeRows[size];
                    return (
                      <tr key={size}>
                        <td className="py-1 pr-2">
                          <label className="flex items-center gap-2 font-medium text-slate-800">
                            <input type="checkbox" checked={Boolean(row)} onChange={() => toggleSize(size)} className="accent-brand-600" />
                            {size}
                          </label>
                        </td>
                        {['chestCm', 'lengthCm', 'sleeveCm'].map((key) => (
                          <td key={key} className="px-1 py-1">
                            <Input
                              type="number"
                              min="1"
                              inputMode="decimal"
                              aria-label={`${size} ${key.replace('Cm', '')} in cm`}
                              disabled={!row}
                              value={row?.[key] ?? ''}
                              onChange={(e) => setRow(size, { [key]: e.target.value })}
                              className="text-center"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {form.postType === 'CLEARANCE' && (
          <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3 sm:grid-cols-2">
            <Field label="Pieces available" required>
              <Input type="number" min="1" value={form.availableQuantity} onChange={(e) => set({ availableQuantity: e.target.value })} />
            </Field>
            <Field label="Guide price per piece (LKR)" required hint="A guide only: the final price is agreed in the Direct Quote.">
              <Input type="number" min="1" value={form.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} />
            </Field>
          </div>
        )}

        {touched && problems.length > 0 && (
          <Alert tone="warning" title="Before you publish">
            <ul className="list-disc space-y-0.5 pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        )}
        <ErrorList error={error} />
      </form>
    </Modal>
  );
}
