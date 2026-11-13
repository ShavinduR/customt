import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, MailCheck, Send } from 'lucide-react';
import { authApi } from '../../api/client';
import AuthShell from './AuthShell';
import { Alert, Button, ErrorList, Field, Input } from '../../components/ui';

const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sentTo, setSentTo] = useState(null);
  const [touched, setTouched] = useState(false);

  const invalid = touched && !EMAIL_RULE.test(email.trim());

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!EMAIL_RULE.test(email.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.forgotPassword(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell title="Check your email" subtitle="We've sent the next step if the account exists.">
        <Alert tone="success" icon={MailCheck} title="Reset link on its way">
          If an account exists for <strong>{sentTo}</strong>, you'll receive an email with a link to choose a new password. The link expires in 15 minutes and works
          once. Check your spam folder if it doesn't arrive within a few minutes.
        </Alert>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            variant="secondary"
            icon={Send}
            onClick={() => {
              setSentTo(null);
              setTouched(false);
            }}
          >
            Use a different email
          </Button>
          <Link to="/login" className="inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-brand-700 hover:bg-brand-50">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot your password?" subtitle="Enter the email you registered with and we'll send you a reset link.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="forgot-email" error={invalid ? 'Enter a valid email address' : null}>
          <Input
            id="forgot-email"
            icon={Mail}
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={invalid}
          />
        </Field>
        <ErrorList error={error} />
        <Button type="submit" size="lg" className="w-full" icon={Send} loading={busy}>
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Remembered it?{' '}
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
