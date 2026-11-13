import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Circle, Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
import { authApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AuthShell from './AuthShell';
import { Alert, Button, ErrorList, Field, Input, cx } from '../../components/ui';

const CHECKS = [
  { label: '8 to 64 characters', test: (p) => p.length >= 8 && p.length <= 64 },
  { label: 'At least one letter', test: (p) => /[A-Za-z]/.test(p) },
  { label: 'At least one number', test: (p) => /\d/.test(p) },
];

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);

  const passes = CHECKS.every((c) => c.test(password));
  const matches = password === confirm;
  const linkProblem = error && ['RESET_TOKEN_INVALID', 'RESET_TOKEN_EXPIRED'].includes(error.code);

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!passes || !matches) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.resetPassword(token, password);
      // Every session was signed out by the reset, including one open in this browser.
      if (user) logout();
      navigate('/login', { replace: true, state: { notice: res.message } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Reset link missing" subtitle="This page needs the link from your reset email.">
        <Alert tone="warning" title="No reset token found">
          Open the link exactly as it appears in the email, or request a new one.
        </Alert>
        <Link to="/forgot-password" className="mt-6 inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Your new password replaces the old one and signs you out on every device.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="New password" htmlFor="new-password">
          <div className="relative">
            <Input
              id="new-password"
              icon={Lock}
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={touched && !passes}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <ul className="grid gap-1 text-sm" aria-label="Password requirements">
          {CHECKS.map((c) => {
            const ok = c.test(password);
            return (
              <li key={c.label} className={cx('flex items-center gap-2', ok ? 'text-emerald-700' : 'text-slate-500')}>
                {ok ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                {c.label}
              </li>
            );
          })}
        </ul>
        <Field label="Confirm new password" htmlFor="confirm-password" error={touched && !matches ? 'Passwords do not match' : null}>
          <Input
            id="confirm-password"
            icon={KeyRound}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            invalid={touched && !matches}
          />
        </Field>

        {linkProblem ? (
          <Alert tone="danger" title={error.message}>
            <Link to="/forgot-password" className="font-semibold underline">
              Request a new reset link
            </Link>
          </Alert>
        ) : (
          <ErrorList error={error} />
        )}

        <Button type="submit" size="lg" className="w-full" icon={KeyRound} loading={busy}>
          Reset password
        </Button>
      </form>
    </AuthShell>
  );
}
