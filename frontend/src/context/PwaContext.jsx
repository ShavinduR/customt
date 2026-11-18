import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, PlusSquare, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { Button, Modal } from '../components/ui';

/**
 * Installable app (PWA) support:
 *  - registers the service worker and offers "Reload" when a new version is ready (never reloads by itself,
 *    so an unsaved form or a half-finished bid is not lost);
 *  - "Install app": the browser's own install dialog (Chrome/Edge on Android, Windows, macOS, ChromeOS), or
 *    step-by-step "Add to Home Screen" instructions on iPhone/iPad, where browsers have no install button;
 *  - an offline banner, because auctions, payments and chat need a connection.
 */

const PwaContext = createContext({ canInstall: false, installed: false, install: () => {} });
const UPDATE_CHECK_MS = 60 * 60 * 1000;

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function PwaProvider({ children }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [iosHelp, setIosHelp] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Long-lived installed apps rarely reload, so look for a new version every hour.
      if (registration) setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_MS);
    },
  });

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault(); // show our own "Install app" button instead of the mini-infobar
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const ios = useMemo(isIOS, []);
  const canInstall = !installed && (Boolean(deferredPrompt) || ios);

  const install = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
      setDeferredPrompt(null);
      if (outcome === 'accepted') setInstalled(true);
    } else if (ios) setIosHelp(true);
  }, [deferredPrompt, ios]);

  const value = useMemo(() => ({ canInstall, installed, install }), [canInstall, installed, install]);

  return (
    <PwaContext.Provider value={value}>
      {children}

      {!online && (
        <div role="status" className="fixed inset-x-0 top-0 z-[80] flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-xs font-medium text-amber-950 shadow">
          <WifiOff className="h-3.5 w-3.5" /> You&apos;re offline. You can keep designing; auctions, payments and messages need a connection.
        </div>
      )}

      {needRefresh && (
        <div role="alert" className="fixed bottom-4 left-1/2 z-[75] flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <RefreshCw className="h-4 w-4" />
          </span>
          <p className="min-w-0 flex-1 text-sm text-slate-700">
            <strong className="block text-slate-900">A new version of CustomT is ready</strong>
            Reload when you&apos;re ready. Your design draft is kept.
          </p>
          <Button size="sm" onClick={() => updateServiceWorker(true)}>
            Reload
          </Button>
          <button type="button" onClick={() => setNeedRefresh(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Later">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Modal open={iosHelp} onClose={() => setIosHelp(false)} title="Install CustomT on your iPhone or iPad" subtitle="Safari adds it to your Home Screen like an app.">
        <ol className="space-y-3 text-sm text-slate-700">
          <li className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>
            <span>
              Open this page in <strong>Safari</strong>, then tap the <strong>Share</strong> button <Share className="inline h-4 w-4 align-text-bottom text-brand-600" />.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span>
            <span>
              Choose <strong>Add to Home Screen</strong> <PlusSquare className="inline h-4 w-4 align-text-bottom text-brand-600" />.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">3</span>
            <span>
              Tap <strong>Add</strong>. CustomT opens full screen from its icon, like any other app.
            </span>
          </li>
        </ol>
      </Modal>
    </PwaContext.Provider>
  );
}

export const usePwa = () => useContext(PwaContext);

/** "Install app" button; renders nothing when the app is installed or the browser can't install it. */
export function InstallAppButton({ className, variant = 'secondary', size = 'sm', label = 'Install app' }) {
  const { canInstall, install } = usePwa();
  if (!canInstall) return null;
  return (
    <Button variant={variant} size={size} icon={Download} onClick={install} className={className}>
      {label}
    </Button>
  );
}
