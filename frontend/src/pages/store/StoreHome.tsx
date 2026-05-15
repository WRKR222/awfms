import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import api from '../../lib/api/client';
import { Egg, Truck, Package, ChevronRight, Lock, AlertCircle, AlertTriangle } from 'lucide-react';
import dayjs from 'dayjs';

export default function StoreHome() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const { data: summary } = useQuery({
    queryKey: ['store-summary'],
    queryFn: () => api.get('/store/summary').then(r => r.data),
  });

  const { data: lowStock = [] } = useQuery({
    queryKey: ['store-items-low'],
    queryFn: () => api.get('/store/inventory/items/low-stock').then(r => r.data),
  });

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  const tasks = [
    {
      label: 'Egg Intake',
      sub: 'Record eggs received from production houses',
      icon: Egg,
      color: 'bg-amber-500',
      route: '/store/egg-intake',
      badge: summary?.pendingIntakeCount > 0 ? summary.pendingIntakeCount : null,
    },
    {
      label: 'Feed Distribution',
      sub: 'Log feed measured and sent to houses',
      icon: Truck,
      color: 'bg-blue-500',
      route: '/store/feed-distribution',
      badge: null,
    },
    {
      label: 'Inventory',
      sub: 'Stock in, stock out, items, purchase requests & LPOs',
      icon: Package,
      color: 'bg-brand-green',
      route: '/store/inventory',
      badge: null,
    },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}!</p>
        <p className="text-sm opacity-75 mt-0.5">Store Management Dashboard</p>
      </div>

      {summary?.totalLockedTrays > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-start gap-3">
          <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              {summary.totalLockedTrays} eggs locked for advance bookings
            </p>
            <p className="text-xs text-amber-500 dark:text-amber-500 mt-0.5">
              Do not dispatch these eggs without Sales Person confirmation.
            </p>
          </div>
        </div>
      )}

      {summary?.pendingIntakeCount > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
            {summary.pendingIntakeCount} session(s) awaiting egg intake
          </p>
        </div>
      )}

      {lowStock.length > 0 && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-2xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
              {lowStock.length} item(s) below reorder level
            </p>
            <p className="text-xs text-orange-500 dark:text-orange-500 mt-0.5">
              {lowStock.slice(0, 3).map((i: any) => i.name).join(', ')}
              {lowStock.length > 3 ? ` and ${lowStock.length - 3} more` : ''}
            </p>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Today’s Tasks
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tasks.map(({ label, sub, icon: Icon, color, route, badge }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="w-full bg-white dark:bg-dark-card rounded-2xl p-4 md:p-5 shadow-sm border border-gray-100 dark:border-dark-border flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98] transition-all group relative"
            >
              {badge && (
                <span className="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {badge}
                </span>
              )}
              <div className={`w-14 h-14 ${color} rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                <Icon className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-800 dark:text-gray-100 text-base">{label}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>
                {label === 'Egg Intake' && summary?.todayTrays > 0 && (
                  <p className="text-xs text-brand-green mt-1 font-medium">
                    Today: {summary.todayTrays} trays received
                  </p>
                )}
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
