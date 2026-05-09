// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useEffect } from 'react';

// Auth
import LoginPage from './pages/auth/LoginPage';

// Layouts
import { AttendantLayout }  from './pages/attendant/AttendantLayout';
import { ManagerLayout }    from './pages/manager/ManagerLayout';
import { AccountantLayout } from './pages/accountant/AccountantLayout';
import { OwnerLayout }      from './pages/owner/OwnerLayout';
import SalesLayout          from './pages/sales/SalesLayout';
import StoreLayout          from './pages/store/StoreLayout';

// Attendant pages
import { AttendantHome }    from './pages/attendant/AttendantHome';
import { EggCollectionPage } from './pages/attendant/EggCollectionPage';

// Manager pages
import { ManagerHome }      from './pages/manager/ManagerHome';
import { ManagerBatches }   from './pages/manager/ManagerBatches';
import { BrooderPage }      from './pages/manager/BrooderPage';
import { FeedHub }          from './pages/manager/FeedHub';
import { VerificationQueue } from './pages/manager/VerificationQueue';

// Accountant pages
import { AccountantHome }   from './pages/accountant/AccountantHome';
import { AccountantPricingPage } from './pages/accountant/AccountantPricingPage';
import { AccountantFinancePage } from './pages/accountant/AccountantFinancePage';
import { AccountantLpoPage } from './pages/accountant/AccountantLpoPage';

// Owner pages
import { OwnerHome }             from './pages/owner/OwnerHome';
import { AiReportsPage }         from './pages/owner/AiReportsPage';
import { DataUploadPage }        from './pages/owner/DataUploadPage';
import { OwnerSalesOrdersPage }  from './pages/owner/OwnerSalesOrdersPage';

// Sales pages
import SalesHome            from './pages/sales/SalesHome';
import { SalesOrders }      from './pages/sales/SalesOrders';
import { AdvanceBookingsPage } from './pages/sales/AdvanceBookingsPage';
import { ClientsPage }      from './pages/sales/ClientsPage';
import SalesBreakagePage    from './pages/sales/SalesBreakagePage';
import SalesDeliveryPage   from './pages/sales/SalesDeliveryPage';

// Store pages
import StoreHome            from './pages/store/StoreHome';
import StoreEggIntake       from './pages/store/StoreEggIntake';
import StoreFeedDistribution from './pages/store/StoreFeedDistribution';
import StoreInventoryPage   from './pages/store/StoreInventoryPage';

// Shared pages
import TallyVerificationPage from './pages/shared/TallyVerificationPage';
import NotificationsPage    from './pages/shared/NotificationsPage';

// Settings
import { SettingsPage }     from './pages/settings/SettingsPage';

// Analytics — Phase 5
import { AnalyticsDashboard } from './pages/analytics/AnalyticsDashboard';


import { VisitorManagementPage } from './pages/manager/VisitorManagementPage';
import { ManagerCullingPage } from './pages/manager/ManagerCullingPage';
import { HealthBiosecurity }   from './pages/attendant/HealthBiosecurity';
import { HealthChecklistPage } from './pages/attendant/HealthChecklistPage';

// Security roles
import Security1Layout      from './pages/security/Security1Layout';
import Security2Layout      from './pages/security/Security2Layout';
import Security1Home        from './pages/security/Security1Home';
import Security2Home        from './pages/security/Security2Home';
import Security1VisitorPage from './pages/security/Security1VisitorPage';
import Security2VisitorPage from './pages/security/Security2VisitorPage';

// Stores & hooks
import { useAuthStore }     from './stores/auth.store';
import { useOfflineStore }  from './stores/offline.store';
import { useOfflineSyncRunner } from './hooks/useOfflineSync';
import { OfflineBanner }    from './components/shared/OfflineBanner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: string[];
}) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function AppInner() {
  const { setOnline } = useOfflineStore();
  useOfflineSyncRunner();

  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [setOnline]);

  return (
    <>
      <OfflineBanner />
      <Routes>
        {/* ── Public ─────────────────────────────────────────────────── */}
        <Route path="/login" element={<LoginPage />} />

        {/* ── Attendant ──────────────────────────────────────────────── */}
        <Route
          path="/attendant"
          element={
            <ProtectedRoute allowedRoles={['ATTENDANT']}>
              <AttendantLayout />
            </ProtectedRoute>
          }
        >
          <Route index                    element={<AttendantHome />} />
          <Route path="egg-collection"    element={<EggCollectionPage />} />
          <Route path="settings"          element={<SettingsPage />} />
          <Route path="notifications"     element={<NotificationsPage />} />
        </Route>

        {/* ── Manager ────────────────────────────────────────────────── */}
        <Route
          path="/manager"
          element={
            <ProtectedRoute allowedRoles={['MANAGER']}>
              <ManagerLayout />
            </ProtectedRoute>
          }
        >
          <Route index                    element={<ManagerHome />} />
          <Route path="batches"           element={<ManagerBatches />} />
          <Route path="brooder"           element={<BrooderPage />} />
          <Route path="feed"              element={<FeedHub />} />
          <Route path="verification"      element={<VerificationQueue />} />
          <Route path="tally"             element={<TallyVerificationPage />} />
          <Route path="visitors"          element={<VisitorManagementPage />} />
          <Route path="analytics"         element={<AnalyticsDashboard role="MANAGER" />} />
          <Route path="notifications"     element={<NotificationsPage />} />
          <Route path="culling"           element={<ManagerCullingPage />} />
          <Route path="health"            element={<HealthBiosecurity />} />
          <Route path="health-checklist"  element={<HealthChecklistPage />} />
          <Route path="settings"          element={<SettingsPage />} />
        </Route>

        {/* ── Accountant ─────────────────────────────────────────────── */}
        <Route
          path="/accountant"
          element={
            <ProtectedRoute allowedRoles={['ACCOUNTANT']}>
              <AccountantLayout />
            </ProtectedRoute>
          }
        >
          <Route index                    element={<AccountantHome />} />
          <Route path="pricing"           element={<AccountantPricingPage />} />
          <Route path="finance"           element={<AccountantFinancePage />} />
          <Route path="tally"             element={<TallyVerificationPage />} />
          <Route path="lpo"               element={<AccountantLpoPage />} />
          <Route path="notifications"     element={<NotificationsPage />} />
          <Route path="settings"          element={<SettingsPage />} />
        </Route>

        {/* ── Owner ──────────────────────────────────────────────────── */}
        <Route
          path="/owner"
          element={
            <ProtectedRoute allowedRoles={['OWNER']}>
              <OwnerLayout />
            </ProtectedRoute>
          }
        >
          <Route index                    element={<OwnerHome />} />
          <Route path="analytics"         element={<AnalyticsDashboard role="OWNER" />} />
          <Route path="reports"           element={<AiReportsPage />} />
          <Route path="data-upload"       element={<DataUploadPage />} />
          <Route path="notifications"     element={<NotificationsPage />} />
          <Route path="sales-orders"       element={<OwnerSalesOrdersPage />} />
          <Route path="settings"          element={<SettingsPage />} />
        </Route>

        {/* ── Sales ──────────────────────────────────────────────────── */}
        <Route
          path="/sales"
          element={
            <ProtectedRoute allowedRoles={['SALES']}>
              <SalesLayout />
            </ProtectedRoute>
          }
        >
          <Route index                    element={<SalesHome />} />
          <Route path="orders"            element={<SalesOrders />} />
          <Route path="bookings"          element={<AdvanceBookingsPage />} />
          <Route path="clients"           element={<ClientsPage />} />
          <Route path="breakage"          element={<SalesBreakagePage />} />
          <Route path="delivery"          element={<SalesDeliveryPage />} />
          <Route path="tally"             element={<TallyVerificationPage />} />
          <Route path="notifications"     element={<NotificationsPage />} />
          <Route path="settings"          element={<SettingsPage />} />
        </Route>

        {/* ── Store ──────────────────────────────────────────────────── */}
        <Route
          path="/store"
          element={
            <ProtectedRoute allowedRoles={['STORE']}>
              <StoreLayout />
            </ProtectedRoute>
          }
        >
          <Route index                    element={<StoreHome />} />
          <Route path="egg-intake"        element={<StoreEggIntake />} />
          <Route path="feed-distribution" element={<StoreFeedDistribution />} />
          <Route path="inventory"        element={<StoreInventoryPage />} />
          <Route path="tally"             element={<TallyVerificationPage />} />
          <Route path="notifications"     element={<NotificationsPage />} />
          <Route path="settings"          element={<SettingsPage />} />
        </Route>

        {/* ── Misc ───────────────────────────────────────────────────── */}
        <Route
          path="/unauthorized"
          element={
            <div className="min-h-screen flex items-center justify-center p-8 text-center">
              <div>
                <p className="text-4xl mb-4">🔒</p>
                <h1 className="text-xl font-bold text-gray-800 mb-2">Access Denied</h1>
                <p className="text-gray-500">Your role does not have permission to view this page.</p>
                <button
                  onClick={() => window.history.back()}
                  className="mt-4 px-4 py-2 bg-brand-green text-white rounded-xl text-sm font-medium"
                >
                  Go Back
                </button>
              </div>
            </div>
          }
        />

        {/* ── Security 1 — Main Gate ─────────────────────────────────── */}
        <Route
          path="/security1"
          element={
            <ProtectedRoute allowedRoles={['SECURITY1']}>
              <Security1Layout />
            </ProtectedRoute>
          }
        >
          <Route index                element={<Security1Home />} />
          <Route path="visitors"      element={<Security1VisitorPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        {/* ── Security 2 — Farm Gate ──────────────────────────────────── */}
        <Route
          path="/security2"
          element={
            <ProtectedRoute allowedRoles={['SECURITY2']}>
              <Security2Layout />
            </ProtectedRoute>
          }
        >
          <Route index                element={<Security2Home />} />
          <Route path="visitors"      element={<Security2VisitorPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        <Route path="/"  element={<RoleRedirect />} />
        <Route path="*"  element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function RoleRedirect() {
  const { user, isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const routes: Record<string, string> = {
    ATTENDANT:  '/attendant',
    MANAGER:    '/manager',
    ACCOUNTANT: '/accountant',
    OWNER:      '/owner',
    SALES:      '/sales',
    STORE:      '/store',
    SECURITY1:  '/security1',
    SECURITY2:  '/security2',
  };
  return <Navigate to={routes[user?.role ?? ''] ?? '/login'} replace />;
}
