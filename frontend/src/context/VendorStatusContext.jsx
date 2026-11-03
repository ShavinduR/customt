import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { vendorApi } from '../api/client';
import { useAuth } from './AuthContext';
import { useSocketEvents } from './SocketContext';
import { PageLoader } from '../components/ui';
import PeraLockScreen from '../components/vendor/PeraLockScreen';

const VendorStatusContext = createContext(null);

/**
 * Route element wrapping every /vendor page: loads the PERA qualification status once
 * and refreshes it live when an admin verifies the vendor or changes their badges/trust.
 */
export function VendorStatusLayout() {
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const res = await vendorApi.status();
      setStatus(res);
      setError(null);
      return res;
    } catch (err) {
      setError(err);
      return null;
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useSocketEvents(['vendor:verification', 'vendor:badges', 'vendor:trust-updated'], () => {
    reload();
    refreshUser().catch(() => {});
  });

  const value = useMemo(() => ({ status, error, reload }), [status, error, reload]);

  if (!status && !error) return <PageLoader label="Checking your prequalification…" />;
  return (
    <VendorStatusContext.Provider value={value}>
      <Outlet />
    </VendorStatusContext.Provider>
  );
}

/** Blocks auction pages for vendors who fail the qualification-level lock. */
export function PeraGate() {
  const { status } = useVendorStatus();
  if (status && !status.isPrequalified) return <PeraLockScreen issues={status.issues} />;
  return <Outlet />;
}

export function useVendorStatus() {
  const ctx = useContext(VendorStatusContext);
  if (!ctx) throw new Error('useVendorStatus must be used inside VendorStatusLayout');
  return ctx;
}
