import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Phone, ShieldCheck, User, UserPlus } from 'lucide-react';
import { authApi } from '../../api/client';
import { roleHome, useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import AuthShell from './AuthShell';
import { Alert, Button, ErrorList, Field, Input, Spinner } from '../../components/ui';
import { FacebookLogo } from '../../components/auth/FacebookButton';

const PHONE_RULE = /^\+?[0-9][0-9\s-]{6,18}$/;

/**
 * Last step of signing up with Facebook: Facebook gives the name and e-mail, CustomT also needs a phone
 * number (used for orders and to protect against one person trading with themselves).
 */
export default function FacebookComplete() {
  const [params] = useSearchParams();
  const ticket = params.get('ticket') || '';
  const { completeFacebookSignup } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    authApi
      .facebookSignup(ticket)
      .then((res) => {
        setPreview(res);
        setName(res.name || '');
      })
      .catch((err) => setLoadError(err));
  }, [ticket]);

  const phoneError = touched && !PHONE_RULE.test(phone.trim()) ? 'Enter a valid phone number, e.g. +94771234567' : null;
  const nameError = touched && name.trim().length < 2 ? 'Please enter your full name' : null;

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!PHONE_RULE.test(phone.trim()) || name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await completeFacebookSignup({ ticket, name: name.trim(), phone: phone.trim() });
      toast.success(res.message, { title: 'Account created' });
      navigate(roleHome(res.user.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Finish creating your account" subtitle="One more step: add the phone number for your orders.">
      {loadError ? (
        <Alert tone="danger" title="This sign-up link has expired">
          {loadError.message}{' '}
          <Link to="/register" className="font-semibold underline">
            Start again
          </Link>
        </Alert>
      ) : !preview ? (
        <Spinner label="Loading…" />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <FacebookLogo className="h-6 w-6 text-[#1877F2]" />
            <div className="min-w-0">
              <p className="font-medium text-slate-900">Signed in with Facebook</p>
              <p className="truncate text-slate-500">{preview.email}</p>
            </div>
          </div>
          <Field label="Full name" required error={nameError}>
            <Input icon={User} autoComplete="name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} invalid={Boolean(nameError)} />
          </Field>
          <Field label="Phone" required error={phoneError} hint="Never shown to other users.">
            <Input icon={Phone} type="tel" autoComplete="tel" placeholder="+94 77 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={Boolean(phoneError)} />
          </Field>
          <ErrorList error={error} />
          <Button type="submit" size="lg" className="w-full" icon={UserPlus} loading={busy}>
            Create my account
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> We only receive your name and e-mail from Facebook, and never post anything.
          </p>
        </form>
      )}
    </AuthShell>
  );
}
