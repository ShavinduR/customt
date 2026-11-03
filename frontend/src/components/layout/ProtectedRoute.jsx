import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { roleHome, useAuth } from '../../context/AuthContext';
import { PageLoader } from '../ui';

/** Guards nested routes by authentication and (optionally) role. */
export default function ProtectedRoute({ roles }) {
  const { user, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <PageLoader label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={roleHome(user.role)} replace />;
  return <Outlet />;
}

/** Sends signed-in users away from public-only pages (login/register). */
export function GuestRoute() {
  const { user, initialising } = useAuth();
  if (initialising) return <PageLoader />;
  if (user) return <Navigate to={roleHome(user.role)} replace />;
  return <Outlet />;
}
