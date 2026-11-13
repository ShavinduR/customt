import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Lock, LogIn, Mail } from 'lucide-react';
import { roleHome, useAuth } from '../../context/AuthContext';
import AuthShell from './AuthShell';
import { Alert, Button, ErrorList, Field, Input } from '../../components/ui';

const DEMO_ACCOUNTS = [
  { label: 'Buyer', email: 'buyer@customt.lk', password: 'Demo@12345' },
  { label: 'Vendor', email: 'vendor1@customt.lk', password: 'Demo@12345' },
  { label: 'Admin', email: 'admin@customt.lk', password: 'Admin@12345' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(form.email.trim(), form.password);
      const from = location.state?.from;
      navigate(from && from !== '/login' ? from : roleHome(res.user.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in to CustomT" subtitle="Welcome back. Your auctions and orders are waiting.">
      {location.state?.notice && (
        <Alert tone="success" className="mb-4">
          {location.state.notice}
        </Alert>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" icon={Mail} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            icon={Lock}
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required
          />
        </Field>
        <div className="-mt-2 text-right">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <ErrorList error={error} />
        <Button type="submit" size="lg" className="w-full" icon={LogIn} loading={busy} disabled={!form.email || !form.password}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        New to CustomT?{' '}
        <Link to="/register" className="font-semibold text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>

      <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Demo accounts (after running the seed script)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.email}
              type="button"
              onClick={() => setForm({ email: a.email, password: a.password })}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
