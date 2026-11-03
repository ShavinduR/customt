import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Alert, Modal, Spinner } from '../ui';

/** True when the browser can decode QR codes natively (Chrome/Edge/Android, Safari 17+ with flag). */
export const qrScanSupported = () =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Scans the buyer's O2O QR code with the device camera and returns the PIN.
 * The QR payload is JSON: { type: "CUSTOMT_O2O", orderCode, pin }.
 */
export default function QrScanner({ open, onClose, expectedOrderCode, onPin }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let stream;
    let timer;
    let cancelled = false;
    setError(null);
    setReady(false);

    (async () => {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
        const scan = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(videoRef.current);
            for (const code of codes) {
              let data;
              try {
                data = JSON.parse(code.rawValue);
              } catch {
                data = null;
              }
              if (data?.type === 'CUSTOMT_O2O' && /^\d{6}$/.test(String(data.pin))) {
                if (expectedOrderCode && data.orderCode && data.orderCode !== expectedOrderCode) {
                  setError(`This QR code belongs to order ${data.orderCode}, not ${expectedOrderCode}.`);
                } else {
                  onPin(String(data.pin));
                  return;
                }
              }
            }
          } catch {
            /* frame not ready - try again */
          }
          timer = setTimeout(scan, 350);
        };
        scan();
      } catch (err) {
        setError(err.name === 'NotAllowedError' ? 'Camera permission was denied. Enter the PIN manually instead.' : 'The camera could not be started on this device.');
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, expectedOrderCode, onPin]);

  return (
    <Modal open={open} onClose={onClose} title="Scan the buyer's O2O QR code" subtitle="Ask the buyer to show the QR from their order page" size="sm">
      <div className="relative overflow-hidden rounded-xl bg-slate-900">
        <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
        {!ready && !error && <Spinner className="absolute inset-0 text-white" label="Starting camera…" />}
        <div className="pointer-events-none absolute inset-10 rounded-2xl border-4 border-white/70" />
        <Camera className="absolute bottom-3 right-3 h-5 w-5 text-white/60" />
      </div>
      {error && (
        <Alert tone="warning" className="mt-3">
          {error}
        </Alert>
      )}
    </Modal>
  );
}
