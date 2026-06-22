// src/pages/manager/ManagerHome.tsx
import { usePendingEntries, useBatches } from '../../hooks/useFlock';
import { useAuthStore } from '../../stores/auth.store';
import { AlertTriangle, Package, ClipboardCheck, Heart, Users, ChevronRight, Flame } from 'lucide-react';
import { useManagerRealtime } from '../../hooks/useRealtime';
import { CageMap } from '../../components/shared/CageMap';
import { useNavigate } from 'react-router-dom';
import { BrooderCageMapGrid } from '../../components/shared/BrooderCageMapGrid';
import { BrooderFeedRequirement } from '../../components/shared/BrooderFeedRequirement';
import { BrooderFeedSummary } from '../../components/shared/BrooderFeedSummary';
import dayjs from '../../lib/dayjs';

export function ManagerHome() {
  useManagerRealtime();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const { data: pending = [] } = usePendingEntries();
  const { data: batches = [] } = useBatches({ isActive: true });

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  const tasks = [
    {
      label: 'Batches',
      sub: 'Manage flock batches',
      icon: Package,
      color: 'bg-brand-green',
      route: '/manager/batches',
    },
    {
      label: 'Verification',
      sub: 'Review pending flock entries',
      icon: ClipboardCheck,
      color: 'bg-blue-500',
      route: '/manager/verification',
      badge: (pending as any[]).length,
    },
    {
      label: 'Health',
      sub: 'Health events and biosecurity log',
      icon: Heart,
      color: 'bg-red-500',
      route: '/manager/health',
    },
    {
      label: 'Visitors',
      sub: 'Manage visitor approvals',
      icon: Users,
      color: 'bg-teal-500',
      route: '/manager/visitors',
    },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      {/* Greeting banner */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}! 👋</p>
        <p className="text-sm opacity-75 mt-0.5">Production Manager Dashboard</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Active Batches</p>
          <p className="text-3xl font-bold text-brand-green">{(batches as any[]).length}</p>
        </div>
        <div className={`rounded-2xl p-4 shadow-sm border ${(pending as any[]).length > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700' : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border'}`}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Pending Verification</p>
          <p className={`text-3xl font-bold ${(pending as any[]).length > 0 ? 'text-amber-600' : 'text-gray-800 dark:text-gray-100'}`}>
            {(pending as any[]).length}
          </p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Birds</p>
          <p className="text-3xl font-bold text-gray-800 dark:text-gray-100">
            {(batches as any[]).reduce((s: number, b: any) => s + (b.currentBirdCount ?? 0), 0).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Task cards */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Today's Tasks</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tasks.map(({ label, sub, icon: Icon, color, route, badge }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="w-full bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98] transition-all group relative"
            >
              {badge != null && badge > 0 && (
                <span className="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {badge}
                </span>
              )}
              <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">{label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0 group-hover:translate-x-0.5 transition-all" />
            </button>
          ))}
        </div>
      </div>

      {/* ── Brooder Feed & Status Summary ── */}
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 bg-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Flame className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-800 dark:text-gray-100">Brooder — Feed & Log Status</p>
            <p className="text-[10px] text-gray-400">Last feed entry per active batch</p>
          </div>
        </div>
        <BrooderFeedSummary />
      </div>

      {/* ── Brooder Required vs Dispensed Feed (per row/level, this week) ── */}
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 bg-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Flame className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-800 dark:text-gray-100">Brooder — Required vs Given Feed</p>
            <p className="text-[10px] text-gray-400">Population × standard ration · this week, by row/level</p>
          </div>
        </div>
        <BrooderFeedRequirement />
      </div>

      {/* Production House Cage Map */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Production House — Cage Map</p>
        <div className="rounded-2xl overflow-hidden shadow-sm border border-dark-border">
          <div style={{ background: '#060c08', padding: '16px 20px' }}>
            <CageMap blockCode="BLK1" compact={false} />
          </div>
        </div>
      </div>

      {/* Brooder Live Cage Map */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Brooder — Cage Map (6 rows × 4 levels)
        </p>
        <BrooderCageMapGrid />
      </div>

    </div>
  );
}
