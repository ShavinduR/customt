import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { metaApi } from '../api/client';

const CatalogContext = createContext(null);

/** Loads /api/meta/catalog once: configurator options, weights, statuses, dispute categories. */
export function CatalogProvider({ children }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    metaApi
      .catalog()
      .then(setCatalog)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const value = useMemo(() => ({ catalog, error, loading, reload: load }), [catalog, error, loading, load]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used inside CatalogProvider');
  return ctx;
}
