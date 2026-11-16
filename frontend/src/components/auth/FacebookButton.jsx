import { useCatalog } from '../../context/CatalogContext';
import { facebookLoginUrl } from '../../api/client';
import { cx } from '../ui';

function FacebookLogo({ className }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" />
    </svg>
  );
}

/**
 * "Continue with Facebook": a plain link to the API, which runs the OAuth flow server-side.
 * No Facebook script is loaded in the page. Hidden when Facebook Login isn't configured on the server.
 */
export default function FacebookButton({ label = 'Continue with Facebook', className }) {
  const { catalog } = useCatalog();
  if (!catalog?.auth?.facebook) return null;
  return (
    <>
      <a
        href={facebookLoginUrl()}
        className={cx(
          'flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-[#1877F2] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#166FE5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2] focus-visible:ring-offset-2',
          className
        )}
      >
        <FacebookLogo className="h-5 w-5" />
        {label}
      </a>
      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        or
        <span className="h-px flex-1 bg-slate-200" />
      </div>
    </>
  );
}

export { FacebookLogo };
