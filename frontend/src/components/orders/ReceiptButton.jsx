import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { downloadOrderReceipt, receiptAvailable } from '../../utils/receipt';
import { Button } from '../ui';

/** Downloads the PDF receipt for a paid order. Renders nothing before payment. */
export default function ReceiptButton({ order, variant = 'secondary', size = 'sm', label = 'Download receipt', className }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!receiptAvailable(order)) return null;

  const download = async () => {
    setBusy(true);
    try {
      await downloadOrderReceipt(order);
    } catch (err) {
      toast.error(err.message || 'The receipt could not be created. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant={variant} size={size} icon={FileDown} loading={busy} onClick={download} className={className}>
      {label}
    </Button>
  );
}
