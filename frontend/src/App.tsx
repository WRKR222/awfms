import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LoginPage } from './pages/Login';
import { AttendantLayout } from './pages/attendant/AttendantLayout';
import { SupervisorLayout } from './pages/supervisor/SupervisorLayout';
import { ManagerLayout } from './pages/manager/ManagerLayout';
import { AccountantLayout } from './pages/accountant/AccountantLayout';
import { OwnerLayout } from './pages/owner/OwnerLayout';
import { useAuthStore } from './stores/auth.store';
import { useOfflineStore } from './stores/offline.store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 2 * 60 * 1000, // 2 minutes
      gcTime: 10 * 60 * 1000,
    },
  },
});

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { setOnline } = useOfflineStore();

  // Track online/offline for PWA offline queue
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/attendant/*" element={
            <ProtectedRoute allowedRoles={['ATTENDANT']}>
              <AttendantLayout />
            </ProtectedRoute>
          } />

          <Route path="/supervisor/*" element={
            <ProtectedRoute allowedRoles={['SUPERVISOR']}>
              <SupervisorLayout />
            </ProtectedRoute>
          } />

          <Route path="/manager/*" element={
            <ProtectedRoute allowedRoles={['MANAGER']}>
              <ManagerLayout />
            </ProtectedRoute>
          } />

          <Route path="/accountant/*" element={
            <ProtectedRoute allowedRoles={['ACCOUNTANT']}>
              <AccountantLayout />
            </ProtectedRoute>
          } />

          <Route path="/owner/*" element={
            <ProtectedRoute allowedRoles={['OWNER']}>
              <OwnerLayout />
            </ProtectedRoute>
          } />

          <Route path="/unauthorized" element={
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
          } />

          <Route path="/" element={<RoleRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function RoleRedirect() {
  const { user, isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const routes: Record<string, string> = {
    ATTENDANT: '/attendant',
    SUPERVISOR: '/supervisor',
    MANAGER: '/manager',
    ACCOUNTANT: '/accountant',
    OWNER: '/owner',
  };
  return <Navigate to={routes[user?.role ?? ''] ?? '/login'} replace />;
}
