import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, roleHome, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { SocketProvider } from './context/SocketContext';
import { CatalogProvider } from './context/CatalogContext';
import ProtectedRoute, { GuestRoute } from './components/layout/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import { PageLoader } from './components/ui';
import Landing from './pages/Landing';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import Account from './pages/Account';
import NotFound from './pages/NotFound';
import BuyerDashboard from './pages/buyer/BuyerDashboard';
import CreateRFQ from './pages/buyer/CreateRFQ';
import RFQList from './pages/buyer/RFQList';
import RFQDetail from './pages/buyer/RFQDetail';
import OrdersList from './pages/buyer/OrdersList';
import OrderDetail from './pages/buyer/OrderDetail';
import { PeraGate, VendorStatusLayout } from './context/VendorStatusContext';
import VendorDashboard from './pages/vendor/VendorDashboard';
import RFQFeed from './pages/vendor/RFQFeed';
import AuctionRoom from './pages/vendor/AuctionRoom';
import MyBids from './pages/vendor/MyBids';
import VendorOrders from './pages/vendor/VendorOrders';
import VendorOrderDetail from './pages/vendor/VendorOrderDetail';
import Wallet from './pages/vendor/Wallet';
import AdminOverview from './pages/admin/AdminOverview';
import VendorVerification from './pages/admin/VendorVerification';
import LiveAuctions from './pages/admin/LiveAuctions';
import Disputes from './pages/admin/Disputes';
import AdminOrders from './pages/admin/AdminOrders';
import AdminOrderDetail from './pages/admin/AdminOrderDetail';
import Analytics from './pages/admin/Analytics';
import UsersAdmin from './pages/admin/UsersAdmin';
import Conversations from './pages/admin/Conversations';

function HomeRoute() {
  const { user, initialising } = useAuth();
  if (initialising) return <PageLoader />;
  return user ? <Navigate to={roleHome(user.role)} replace /> : <Landing />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <CatalogProvider>
              <Routes>
                <Route path="/" element={<HomeRoute />} />
                <Route element={<GuestRoute />}>
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                </Route>
                <Route path="/reset-password" element={<ResetPassword />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route path="/account" element={<Account />} />

                    <Route element={<ProtectedRoute roles={['buyer']} />}>
                      <Route path="/buyer" element={<BuyerDashboard />} />
                      <Route path="/buyer/rfqs" element={<RFQList />} />
                      <Route path="/buyer/rfqs/new" element={<CreateRFQ />} />
                      <Route path="/buyer/rfqs/:id" element={<RFQDetail />} />
                      <Route path="/buyer/orders" element={<OrdersList />} />
                      <Route path="/buyer/orders/:id" element={<OrderDetail />} />
                    </Route>

                    <Route element={<ProtectedRoute roles={['vendor']} />}>
                      <Route element={<VendorStatusLayout />}>
                        <Route path="/vendor" element={<VendorDashboard />} />
                        <Route path="/vendor/bids" element={<MyBids />} />
                        <Route path="/vendor/orders" element={<VendorOrders />} />
                        <Route path="/vendor/orders/:id" element={<VendorOrderDetail />} />
                        <Route path="/vendor/wallet" element={<Wallet />} />
                        <Route element={<PeraGate />}>
                          <Route path="/vendor/rfqs" element={<RFQFeed />} />
                          <Route path="/vendor/rfqs/:id" element={<AuctionRoom />} />
                        </Route>
                      </Route>
                    </Route>

                    <Route element={<ProtectedRoute roles={['admin']} />}>
                      <Route path="/admin" element={<AdminOverview />} />
                      <Route path="/admin/vendors" element={<VendorVerification />} />
                      <Route path="/admin/auctions" element={<LiveAuctions />} />
                      <Route path="/admin/disputes" element={<Disputes />} />
                      <Route path="/admin/orders" element={<AdminOrders />} />
                      <Route path="/admin/orders/:id" element={<AdminOrderDetail />} />
                      <Route path="/admin/analytics" element={<Analytics />} />
                      <Route path="/admin/users" element={<UsersAdmin />} />
                      <Route path="/admin/messages" element={<Conversations />} />
                    </Route>

                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Route>
              </Routes>
            </CatalogProvider>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
