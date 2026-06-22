// src/pages/store/StoreHome.tsx
// Store dashboard — egg intake and feed distribution removed from the workflow.
// Workflow: PM verification → Tally sign-off (directly). Store's primary
// daily duty is signing off the next-morning tally, managing inventory,
// purchase requests, HR records and visitor logs.

import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import api from '../../lib/api/client';
import { CheckSquare, Package, ClipboardList, Users, UserCheck, ChevronRight, Lock, AlertTriangle, Clock, Calendar } from 'lucide-react';
import dayjs from '../../lib/dayjs';

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

  const pendingTallies: number = summary?.pendingTallies ?? 0;
  const isSaturday = dayjs().day() === 6;

  const tasks = [
    {
      label: 'Tally Sign-off',
      sub: 'Sign off on previous day AM & PM egg collection sessions',
      icon: CheckSquare,
      color: pendingTallies > 0 ? 'bg-brand-green' : 'bg-gray-400',
      route: '/store/tally',
      badge: pendingTallies > 0 ? pendingTallies : null,
      priority: true,
    },
    {
      label: 'Inventory',
      sub: 'Stock in, stock out, items & issuance plans',
      icon: Package,
      color: 'bg-brand-green',
      route: '/store/inventory',
      badge: null,
    },
    {
      label: 'Issuance Plans',
      sub: 'Weekly & emergency issuance plans awaiting approval',
      icon: ClipboardList,
      color: 'bg-indigo-500',
      route: '/store/issuance-plans',
      badge: null,
    },
    {
      label: 'HR Records',
      sub: 'Staff attendance and farm HR management',
      icon: Users,
      color: 'bg-purple-500',
      route: '/store/hr',
      badge: null,
    },
    {
      label: 'Visitor Log',
      sub: 'Record and review farm visitors',
      icon: UserCheck,
      color: 'bg-teal-500',
      route: '/store/visitors',
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

      {/* Saturday weekly issuance plan reminder */}
      {isSaturday && (
        <div
          className="bg-indigo-50 dark:bg-indigo-900/20 border-2 border-indigo-300 dark:border-indigo-700 rounded-2xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/store/issuance-plans')}
        >
          <Calendar className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
              📋 It's Saturday — time to create next week's issuance plan!
            </p>
            <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-0.5">
              Draft and submit the weekly issuance plan for the coming Mon–Sun cycle before end of day.
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-indigo-400 shrink-0" />
        </div>
      )}

      {/* Tally pending alert — top priority */}
      {pendingTallies > 0 && (
        <div
          className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-2xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/store/tally')}
        >
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              {pendingTallies} tally session{pendingTallies > 1 ? 's' : ''} awaiting your sign-off
            </p>
            <p className="text-xs text-amber-500 dark:text-amber-500 mt-0.5">
              Tap to review and sign off on the morning tally.
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-amber-500 shrink-0" />
        </div>
      )}

      {/* Locked bookings warning */}
      {(summary?.totalLockedTrays ?? 0) > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl px-4 py-3 flex items-start gap-3">
          <Lock className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">
              {summary.totalLockedTrays} eggs locked for advance bookings
            </p>
            <p className="text-xs text-blue-500 dark:text-blue-500 mt-0.5">
              Do not dispatch these eggs without Sales Person confirmation.
            </p>
          </div>
        </div>
      )}

      {/* Low stock warning */}
      {(lowStock as any[]).length > 0 && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-2xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
              {(lowStock as any[]).length} item(s) below reorder level
            </p>
            <p className="text-xs text-orange-500 dark:text-orange-500 mt-0.5">
              {(lowStock as any[]).slice(0, 3).map((i: any) => i.name).join(', ')}
              {(lowStock as any[]).length > 3 ? ` and ${(lowStock as any[]).length - 3} more` : ''}
            </p>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Today's Tasks
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tasks.map(({ label, sub, icon: Icon, color, route, badge, priority }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className={`w-full bg-white dark:bg-dark-card rounded-2xl p-4 md:p-5 shadow-sm border flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98] transition-all group relative ${
                priority && pendingTallies > 0
                  ? 'border-amber-200 dark:border-amber-700'
                  : 'border-gray-100 dark:border-dark-border'
              }`}
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
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
