import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, CalendarDays, Factory, Hash, Lock, Mail, Phone, ShieldCheck, ShoppingBag, User, UserPlus } from 'lucide-react';
import { roleHome, useAuth } from '../../context/AuthContext';
import { useCatalog } from '../../context/CatalogContext';
import { useToast } from '../../context/ToastContext';
import AuthShell from './AuthShell';
import { Alert, Button, ErrorList, Field, Input, cx } from '../../components/ui';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RULE = /^\+?[0-9][0-9\s-]{6,18}$/;

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
  companyName: '',
  businessRegNo: '',
  capabilities: [],
  maxCapacity: '',
  licenseExpiryDate: '',
};

function validate(role, f) {
  const errors = {};
  if (f.name.trim().length < 2) errors.name = 'Please enter your full name';
  if (!EMAIL_RULE.test(f.email.trim())) errors.email = 'Enter a valid email address';
  if (!PHONE_RULE.test(f.phone.trim())) errors.phone = 'Enter a valid phone number, e.g. +94771234567';
  if (!PASSWORD_RULE.test(f.password)) errors.password = '8-64 characters with at least one letter and one number';
  if (f.confirmPassword !== f.password) errors.confirmPassword = 'Passwords do not match';
  if (role === 'vendor') {
    if (f.companyName.trim().length < 2) errors.companyName = 'Company name is required';
    if (f.businessRegNo.trim().length < 3) errors.businessRegNo = 'Business registration number is required';
    if (f.capabilities.length === 0) errors.capabilities = 'Select at least one printing capability';
    const cap = Number(f.maxCapacity);
    if (!Number.isInteger(cap) || cap < 1) errors.maxCapacity = 'Enter your maximum pieces per order';
    if (!f.licenseExpiryDate) errors.licenseExpiryDate = 'License expiry date is required for verification';
    else if (new Date(f.licenseExpiryDate) <= new Date()) errors.licenseExpiryDate = 'Your business license must not be expired';
  }
  return errors;
}

export default function Register() {
  const { register } = useAuth();
  const { catalog } = useCatalog();
  const toast = useToast();
  const navigate = useNavigate();
  const [role, setRole] = useState('buyer');
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const errors = validate(role, form);
  const show = (key) => (touched ? errors[key] : null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const printTypes = catalog?.printTypes || ['Screen Printing', 'DTF', 'Embroidery', 'Sublimation'];

  const toggleCapability = (cap) =>
    setForm((f) => ({ ...f, capabilities: f.capabilities.includes(cap) ? f.capabilities.filter((c) => c !== cap) : [...f.capabilities, cap] }));

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(null);
    const payload = { role, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password };
    if (role === 'vendor') {
      Object.assign(payload, {
        companyName: form.companyName.trim(),
        businessRegNo: form.businessRegNo.trim(),
        capabilities: form.capabilities,
        maxCapacity: Number(form.maxCapacity),
        licenseExpiryDate: form.licenseExpiryDate,
      });
    }
    try {
      const res = await register(payload);
      toast.success(res.message, { title: 'Account created', duration: 8000 });
      navigate(roleHome(res.user.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const minLicenseDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  return (
    <AuthShell title="Create your CustomT account" subtitle="Join as a buyer to source apparel, or as an SME printer to win orders." wide>
      <div className="mb-6 grid grid-cols-2 gap-3">
        {[
          { value: 'buyer', title: 'Buyer', text: 'Customers & event organisers', icon: ShoppingBag },
          { value: 'vendor', title: 'Vendor (SME)', text: 'Apparel printers & embroiderers', icon: Factory },
        ].map(({ value, title, text, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setRole(value)}
            aria-pressed={role === value}
            className={cx('rounded-xl border p-4 text-left transition', role === value ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 hover:bg-slate-50')}
          >
            <Icon className={cx('h-5 w-5', role === value ? 'text-brand-600' : 'text-slate-400')} />
            <p className="mt-2 font-semibold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">{text}</p>
          </button>
        ))}
      </div>

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

        {role === 'vendor' && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-brand-600" />
              <div>
                <p className="font-semibold text-slate-900">Business prequalification (PERA)</p>
                <p className="text-sm text-slate-500">
                  These details decide which auctions you are eligible for. An administrator verifies your business before you can bid.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" required error={show('companyName')}>
                <Input icon={Building2} autoComplete="organization" value={form.companyName} onChange={set('companyName')} invalid={Boolean(show('companyName'))} />
              </Field>
              <Field label="Business registration no." required error={show('businessRegNo')}>
                <Input icon={Hash} placeholder="PV-123456" value={form.businessRegNo} onChange={set('businessRegNo')} invalid={Boolean(show('businessRegNo'))} />
              </Field>
              <Field label="Max capacity per order (pcs)" required error={show('maxCapacity')} hint="You'll only see RFQs up to this quantity">
                <Input icon={Factory} type="number" min="1" value={form.maxCapacity} onChange={set('maxCapacity')} invalid={Boolean(show('maxCapacity'))} />
              </Field>
              <Field label="Business license expiry" required error={show('licenseExpiryDate')}>
                <Input icon={CalendarDays} type="date" min={minLicenseDate} value={form.licenseExpiryDate} onChange={set('licenseExpiryDate')} invalid={Boolean(show('licenseExpiryDate'))} />
              </Field>
            </div>
            <Field label="Printing capabilities" required error={show('capabilities')}>
              <div className="grid grid-cols-2 gap-2">
                {printTypes.map((cap) => {
                  const on = form.capabilities.includes(cap);
                  return (
                    <label
                      key={cap}
                      className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition', on ? 'border-brand-500 bg-white text-brand-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleCapability(cap)} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
                      {cap}
                    </label>
                  );
                })}
              </div>
            </Field>
            <Alert tone="info">New vendors start with a trust score of 3.5. It rises with every well-rated order you complete.</Alert>
          </div>
        )}

        {touched && Object.keys(errors).length > 0 && <Alert tone="warning">Please fix the highlighted fields.</Alert>}
        <ErrorList error={error} />
        <Button type="submit" size="lg" className="w-full" icon={UserPlus} loading={busy}>
          {role === 'vendor' ? 'Register my business' : 'Create buyer account'}
        </Button>
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
