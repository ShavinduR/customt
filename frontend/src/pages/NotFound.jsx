import { Link } from 'react-router-dom';
import { Shirt } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <Shirt className="h-12 w-12 text-slate-300" />
      <p className="mt-4 font-display text-6xl tracking-wide text-slate-900">404</p>
      <p className="mt-2 text-slate-500">This page doesn't exist, or it has been moved.</p>
      <Link to="/" className="mt-6 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
        Back to CustomT
      </Link>
    </div>
  );
}
