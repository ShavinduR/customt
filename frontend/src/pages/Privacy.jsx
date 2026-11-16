import { Link } from 'react-router-dom';
import { Logo } from '../components/layout/AppLayout';

/** Set VITE_SUPPORT_EMAIL on Vercel to show the address for deletion requests. */
const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL || '').trim();

const Section = ({ id, title, children }) => (
  <section id={id} className="scroll-mt-20">
    <h2 className="mt-8 text-lg font-semibold text-slate-900">{title}</h2>
    <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
  </section>
);

/**
 * Public privacy notice. Facebook requires a privacy policy URL and data-deletion instructions before a
 * Facebook Login app can go live: use /privacy and /privacy#data-deletion in the Facebook app settings.
 * Keep this page in line with what the code actually does.
 */
export default function Privacy() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-4">
          <Logo />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Privacy and data deletion</h1>
        <p className="mt-2 text-sm text-slate-500">CustomT: custom apparel marketplace with reverse auctions and escrow payments.</p>

        <Section title="What we collect">
          <p>
            <strong>Account:</strong> your name, e-mail address, phone number and, if you set one, a password (stored only as a one-way hash).
          </p>
          <p>
            <strong>Facebook Login (optional):</strong> when you continue with Facebook we receive only your name, e-mail address and an app-specific Facebook ID. We do
            not receive your friends, posts or photos, we never post to Facebook, and we do not keep your Facebook access token.
          </p>
          <p>
            <strong>Orders:</strong> RFQ designs, bids, order and escrow records, messages in order chats, and ratings.
          </p>
          <p>
            <strong>Vendor applications (KYB):</strong> business details, the owner&apos;s name and NIC (stored only as a secure fingerprint and the last 4 characters),
            and the documents you upload: BR copy, NIC images, utility bill and invoices.
          </p>
        </Section>

        <Section title="How we use and protect it">
          <p>Your data is used to run your account, match RFQs with verified printers, process escrow payments and resolve disputes.</p>
          <p>
            Phone numbers and e-mail addresses are never shown to other buyers or vendors. Vendor documents are kept in private storage, can be opened only by CustomT
            administrators, and every view is recorded.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Documents of vendor applications that are rejected or withdrawn are deleted automatically after 180 days. Order and payment records are kept as long as
            needed for the escrow and dispute history.
          </p>
        </Section>

        <Section id="data-deletion" title="Deleting your data (including Facebook data)">
          <p>To remove the Facebook connection: sign in, open <strong>Account → Sign-in methods</strong> and choose <strong>Unlink</strong>. The Facebook ID is deleted
            from your account immediately. You can also remove CustomT from Facebook under <em>Settings → Apps and websites</em>.</p>
          <p>
            To delete your whole account and the personal data in it, send a request from the e-mail address on your account
            {SUPPORT_EMAIL ? (
              <>
                {' '}to <a href={`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20account`} className="font-medium text-brand-700 underline">{SUPPORT_EMAIL}</a>
              </>
            ) : (
              ' to the CustomT team'
            )}{' '}
            with the subject &ldquo;Delete my account&rdquo;. We confirm the request and delete or anonymise your data, except records we must keep for completed
            payments.
          </p>
        </Section>

        <p className="mt-10 text-sm">
          <Link to="/" className="font-medium text-brand-700 hover:underline">
            Back to CustomT
          </Link>
        </p>
      </main>
    </div>
  );
}
