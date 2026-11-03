import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, setUnauthorizedHandler, tokenStore } from '../api/client';

const AuthContext = createContext(null);

/** Landing page for each role after login. */
export function roleHome(role) {
  switch (role) {
    case 'buyer':
      return '/buyer';
    case 'vendor':
      return '/vendor';
    case 'admin':
      return '/admin';
    default:
      return '/account';
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => tokenStore.get());
  const [initialising, setInitialising] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setInitialising(false);
      return undefined;
    }
    authApi
      .me()
      .then((res) => !cancelled && setUser(res.user))
      .catch(() => !cancelled && logout())
      .finally(() => !cancelled && setInitialising(false));
    return () => {
      cancelled = true;
    };
    // Only re-validate when the token itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const applySession = useCallback((res) => {
    tokenStore.set(res.token);
    setUser(res.user);
    setToken(res.token);
    return res;
  }, []);

  const login = useCallback((email, password) => authApi.login({ email, password }).then(applySession), [applySession]);
  const register = useCallback((payload) => authApi.register(payload).then(applySession), [applySession]);

  const refreshUser = useCallback(async () => {
    const res = await authApi.me();
    setUser(res.user);
    return res.user;
  }, []);

  const value = useMemo(
    () => ({ user, token, initialising, isAuthenticated: Boolean(user), login, register, logout, refreshUser, setUser }),
    [user, token, initialising, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
