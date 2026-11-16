import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Mail, Phone, ShieldCheck, Store, User, UserPlus } from 'lucide-react';
import { roleHome, useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import AuthShell from './AuthShell';
import FacebookButton from '../../components/auth/FacebookButton';
import { Alert, Button, ErrorList, Field, Input } from '../../components/ui';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RULE = /^\+?[0-9][0-9\s-]{6,18}$/;

const EMPTY = { name: '', email: '', phone: '', password: '', confirmPassword: '' };

function validate(f) {
  const errors = {};
  if (f.name.trim().length < 2) errors.name = 'Please enter your full name';
  if (!EMAIL_RULE.test(f.email.trim())) errors.email = 'Enter a valid email address';
  if (!PHONE_RULE.test(f.phone.trim())) errors.phone = 'Enter a valid phone number, e.g. +94771234567';
  if (!PASSWORD_RULE.test(f.password)) errors.password = '8-64 characters with at least one letter and one number';
  if (f.confirmPassword !== f.password) errors.confirmPassword = 'Passwords do not match';
  return errors;
}

/**
 * Unified registration: every account starts as a buyer. Printers apply to sell afterwards
 * ("Sell on CustomT"), with business documents that an administrator verifies (KYB).
 */
export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const errors = validate(form);
  const show = (key) => (touched ? errors[key] : null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await register({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password });
      toast.success(res.message, { title: 'Account created', duration: 8000 });
      navigate(roleHome(res.user.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your CustomT account" subtitle="Design custom apparel, get competing quotes and pay safely through escrow." wide>
      <FacebookButton label="Sign up with Facebook" />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={show('name')} className="sm:col-span-2">
            <Input icon={User} autoComplete="name" value={form.name} onChange={set('name')} invalid={Boolean(show('name'))} />
          </Field>
          <Field label="Email" required error={show('email')}>
            <Input icon={Mail} type="email" autoComplete="email" value={form.email} onChange={set('email')} invalid={Boolean(show('email'))} />
          </Field>
          <Field label="Phone" required error={show('phone')}>
            <Input icon={Phone} type="tel" autoComplete="tel" placeholder="+94 77 123 4567" value={form.phone} onChange={set('phone')} invalid={Boolean(show('phone'))} />
          </Field>
          <Field label="Password" required error={show('password')} hint="At least 8 characters, including a letter and a number">
            <Input icon={Lock} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} invalid={Boolean(show('password'))} />
          </Field>
          <Field label="Confirm password" required error={show('confirmPassword')}>
            <Input icon={Lock} type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set('confirmPassword')} invalid={Boolean(show('confirmPassword'))} />
          </Field>
        </div>

        <Alert tone="info" icon={Store} title="Are you a printer?">
          Create your account first, then open <strong>Sell on CustomT</strong> to apply as a vendor. We verify every business with its BR copy, the owner&apos;s
          NIC, a utility bill and recent invoices before it can sell.
        </Alert>

        {touched && Object.keys(errors).length > 0 && <Alert tone="warning">Please fix the highlighted fields.</Alert>}
        <ErrorList error={error} />
        <Button type="submit" size="lg" className="w-full" icon={UserPlus} loading={busy}>
          Create account
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Your phone number and e-mail are never shown to other users.
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
