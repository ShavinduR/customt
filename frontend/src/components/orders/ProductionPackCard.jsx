import { useMemo, useState } from 'react';
import { FileArchive, FileImage, FileText, Loader2, Lock, PackageCheck } from 'lucide-react';
import { Alert, Button, Card, CardHeader } from '../ui';
import { useToast } from '../../context/ToastContext';
import { PRINT_AREAS, SIDE_LABEL, UNITS_PER_CM } from '../../utils/garmentGeometry';
import { printedSides } from '../../utils/design';

const DPI = 300;
const fmt = (v) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
/** Escrow states in which the buyer's money is (or was) held for this order. */
const FUNDED = ['ESCROW_LOCKED', 'PARTIALLY_RELEASED', 'FUNDS_RELEASED', 'FROZEN', 'SPLIT_SETTLED'];

/**
 * Production pack (order pages): real-size 300 DPI print files for every printed side plus the spec sheet,
 * as one ZIP. The printer can download it once the buyer has funded escrow; the buyer and admins can always
 * check it. Files are generated on this device from the locked specification.
 */
export default function ProductionPackCard({ order, rfq, role }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const specs = rfq?.designSpecs;
  const funded = FUNDED.includes(order?.escrowStatus);
  const closed = ['CANCELLED', 'REFUNDED'].includes(order?.orderStatus);
  const locked = role === 'vendor' && (!funded || closed);

  const files = useMemo(() => {
    if (!specs) return [];
    const areas = PRINT_AREAS[specs.garmentType] || PRINT_AREAS['Crew Neck'];
    return printedSides(specs).map((side) => {
      const a = areas[side];
      const wCm = a.w / UNITS_PER_CM;
      const hCm = a.h / UNITS_PER_CM;
      const px = (cm) => Math.round((cm / 2.54) * DPI);
      return { side, name: `${side}_${fmt(wCm)}x${fmt(hCm)}cm_${DPI}dpi.png`, size: `${fmt(wCm)} × ${fmt(hCm)} cm`, pixels: `${px(wCm)} × ${px(hCm)} px` };
    });
  }, [specs]);

  if (!specs) return null;

  const download = async () => {
    setBusy('Preparing…');
    try {
      const { downloadProductionPack } = await import('../../utils/productionPack');
      await downloadProductionPack(specs, { code: rfq.rfqCode, title: rfq.title, description: rfq.description, expectedDeliveryDays: rfq.expectedDeliveryDays }, setBusy);
      toast.success('Production pack downloaded.');
    } catch (err) {
      toast.error(err.message || 'Could not create the production pack.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader icon={PackageCheck} title="Production pack" subtitle="Print-ready files at real size, plus the spec sheet" />
      <div className="space-y-4 p-5">
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {files.map((f) => (
            <li key={f.side} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileImage className="h-4 w-4 shrink-0 text-brand-600" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{SIDE_LABEL[f.side]} print file</span>
                <span className="block truncate font-mono text-[11px] text-slate-500">{f.name}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-slate-500">
                {f.size}
                <span className="block">{f.pixels}</span>
              </span>
            </li>
          ))}
          <li className="flex items-center gap-3 px-3 py-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-brand-600" />
            <span className="flex-1 font-medium text-slate-900">Spec sheet (PDF)</span>
            <span className="text-xs text-slate-500">sizes, positions, colours</span>
          </li>
        </ul>

        {locked ? (
          <Alert tone="info" icon={Lock} title={closed ? 'Not available for this order' : 'Unlocks when the buyer funds escrow'}>
            {closed
              ? 'This order was cancelled or refunded, so the artwork files are not released.'
              : "The buyer's artwork is released to you as soon as payment is held in escrow, so you never start production unpaid."}
          </Alert>
        ) : (
          <>
            <Button icon={busy ? Loader2 : FileArchive} loading={Boolean(busy)} onClick={download} className="w-full sm:w-auto">
              {busy || 'Download production pack (ZIP)'}
            </Button>
            <p className="text-xs leading-relaxed text-slate-500">
              Transparent PNGs at {DPI} DPI, each covering its side&apos;s whole print area. Place the print area as described in the spec sheet and the
              artwork lands exactly where the buyer designed it. Files are created on this device and can take a few seconds per side.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
