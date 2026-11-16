import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { roleHome, useAuth } from '../../context/AuthContext';
import AuthShell from './AuthShell';
import { Alert, Spinner } from '../../components/ui';

/**
 * Landing page after Facebook Login: /auth/callback?code=<one-time code>.
 * The code (valid 60 s, single use) is exchanged for a normal session, then removed from the address bar.
 */
export default function AuthCallback() {
  const { exchangeLoginCode } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React StrictMode runs effects twice in development; the code works once
    started.current = true;
    const code = params.get('code');
    window.history.replaceState(null, '', '/auth/callback'); // don't keep the code in history
    if (!code) {
      setError('This sign-in link is incomplete.');
      return;
    }
    exchangeLoginCode(code)
      .then((res) => navigate(roleHome(res.user.role), { replace: true }))
      .catch((err) => setError(err.message));
  }, [params, exchangeLoginCode, navigate]);

  return (
    <AuthShell title="Signing you in…" subtitle="Connecting your Facebook account to CustomT.">
      {error ? (
        <Alert tone="danger" title="Sign-in failed">
          {error}{' '}
          <Link to="/login" className="font-semibold underline">
            Back to sign in
          </Link>
        </Alert>
      ) : (
        <Spinner label="One moment…" />
      )}
    </AuthShell>
  );
}
