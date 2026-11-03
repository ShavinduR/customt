import { useMemo, useState } from 'react';
import { HeartHandshake, Snowflake } from 'lucide-react';
import { orderApi } from '../../api/client';
import { useCatalog } from '../../context/CatalogContext';
import { Alert, Button, ErrorList, Field, Modal, Select, Textarea, cx } from '../ui';
import { formatLKR } from '../../utils/format';

const RESOLUTION_LABEL = {
  REPRINT: { title: 'Reprint', text: 'The vendor fixes or reprints the affected pieces' },
  PARTIAL_REFUND: { title: 'Partial refund', text: 'Keep the goods with a fair price reduction' },
  FULL_REFUND: { title: 'Full refund', text: 'The goods are unusable for your purpose' },
  OTHER: { title: 'Other', text: 'Describe your preferred outcome' },
};

const HEATED = /\b(scam|fraud|cheat|liar|idiot|stupid|useless|garbage|trash|worst|pathetic|incompetent|rubbish|disgusting)\w*/i;

/** Client-side mirror of the server's tone screening so buyers get a gentle nudge before submitting. */
function toneHint(text) {
  const letters = text.replace(/[^a-z]/gi, '');
  const shouting = letters.length > 15 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6;
  const exclaims = (text.match(/!/g) || []).length >= 4;
  if (HEATED.test(text) || shouting || exclaims) {
    return "We completely understand your frustration. Specific, calm descriptions (what's wrong, how many pieces, how it differs from the spec) help our mediator resolve this faster.";
  }
  return null;
}

export default function DisputeModal({ order, open, onClose, onRaised }) {
  const { catalog } = useCatalog();
  const categories = catalog?.disputeCategories || {};
  const resolutions = catalog?.disputeDesiredResolutions || Object.keys(RESOLUTION_LABEL);
  const [form, setForm] = useState({ category: '', desiredResolution: 'REPRINT', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [acknowledgement, setAcknowledgement] = useState(null);

  const hint = useMemo(() => toneHint(form.description), [form.description]);
  const length = form.description.trim().length;
  const valid = form.category && length >= 20 && length <= 2000;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await orderApi.dispute(order._id, form);
      const ack = res.order.disputeNotes?.find((n) => n.template === 'BUYER_ACKNOWLEDGEMENT');
      setAcknowledgement(ack?.message || res.message);
      onRaised(res.order);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setAcknowledgement(null);
    setForm({ category: '', desiredResolution: 'REPRINT', description: '' });
    onClose();
  };

  if (acknowledgement) {
    return (
      <Modal open={open} onClose={close} title="We're on it" footer={<Button onClick={close}>Close</Button>}>
        <div className="flex gap-3">
          <HeartHandshake className="h-8 w-8 shrink-0 text-brand-500" />
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{acknowledgement}</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!busy}
      size="lg"
      title="Raise a quality dispute"
      subtitle={`Order ${order.orderCode}`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={Snowflake} loading={busy} disabled={!valid} onClick={submit}>
            Freeze escrow & submit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning" icon={Snowflake} title="What happens when you submit">
          The remaining {formatLKR(order.escrowHeld)} is frozen immediately, the vendor is notified respectfully, and a CustomT mediator reviews the case against the locked specification.
        </Alert>

        <Field label="What went wrong?" required>
          <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} invalid={error && !form.category}>
            <option value="">Select an issue…</option>
            {Object.entries(categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Preferred resolution</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {resolutions.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setForm((f) => ({ ...f, desiredResolution: r }))}
                className={cx(
                  'rounded-xl border p-3 text-left transition',
                  form.desiredResolution === r ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 hover:bg-slate-50'
                )}
              >
                <span className="block text-sm font-semibold text-slate-900">{RESOLUTION_LABEL[r]?.title || r}</span>
                <span className="block text-xs text-slate-500">{RESOLUTION_LABEL[r]?.text}</span>
              </button>
            ))}
          </div>
        </div>

        <Field label="Describe the issue" required hint={`${length}/2000 characters · at least 20`} error={length > 0 && length < 20 ? `Please add a little more detail (${20 - length} more characters)` : null}>
          <Textarea
            rows={5}
            maxLength={2000}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="e.g. 35 of the 120 shirts have the logo printed 3 cm lower than the approved design, and the navy is noticeably lighter than #1E3A8A."
          />
        </Field>
        {hint && (
          <Alert tone="info" icon={HeartHandshake}>
            {hint}
          </Alert>
        )}
        <ErrorList error={error} />
      </div>
    </Modal>
  );
}
