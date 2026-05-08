import { usePendingEntries, useBatches } from '../../hooks/useFlock';
import { useFeedStock } from '../../hooks/useFeed';
import { useAuthStore } from '../../stores/auth.store';
import { AlertTriangle, Package, ClipboardCheck, Wheat, Heart, ClipboardList, Users, ChevronRight, Flame, Thermometer, Droplets, Sun } from 'lucide-react';
import { useManagerRealtime } from '../../hooks/useRealtime';
import { CageMap } from '../../components/shared/CageMap';
import { BrooderCageMap } from '../../components/shared/BrooderCageMap';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

export function ManagerHome() {
  useManagerRealtime();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const { data: pending = [] } = usePendingEntries();
  const { data: batches = [] } = useBatches({ isActive: true });
  const { data: feedStock } = useFeedStock();

  const lowFeedAlerts = feedStock
    ? Object.values(feedStock).filter((s: any) => s.isLow)
    : [];

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
      label: 'Feed Hub',
      sub: 'Monitor and manage feed stock',
      icon: Wheat,
      color: 'bg-amber-500',
      route: '/manager/feed',
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
      label: 'Checklist',
      sub: 'AM and PM farm checklist',
      icon: ClipboardList,
      color: 'bg-purple-500',
      route: '/manager/health-checklist',
    },
    {
      label: 'Visitors',
      sub: 'Manage visitor approvals',
      icon: Users,
      color: 'bg-teal-500',
      route: '/manager/visitors',
    },
  ];

  const brooderTasks = [
    {
      label: 'Log Temperature',
      sub: 'Record brooder house temperature',
      icon: Thermometer,
      color: 'bg-orange-500',
      route: '/manager/brooder',
    },
    {
      label: 'Water Consumption',
      sub: 'Log daily water intake for brooder',
      icon: Droplets,
      color: 'bg-cyan-500',
      route: '/manager/brooder',
    },
    {
      label: 'Lighting Check',
      sub: 'Verify brooder lighting is consistent',
      icon: Sun,
      color: 'bg-yellow-500',
      route: '/manager/brooder',
    },
    {
      label: 'Brooder Vaccines',
      sub: 'Register any vaccines administered',
      icon: Flame,
      color: 'bg-amber-600',
      route: '/manager/brooder',
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

      {/* Feed alert */}
      {lowFeedAlerts.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <p className="font-bold text-red-700 dark:text-red-400">Low Feed Stock Alert</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowFeedAlerts.map((s: any) => (
              <span key={s.feedType} className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs px-3 py-1 rounded-full font-medium">
                {s.feedType.replace(/_/g, ' ')} — {s.daysRemaining}d left
              </span>
            ))}
          </div>
        </div>
      )}

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
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Feed Alerts</p>
          <p className={`text-3xl font-bold ${lowFeedAlerts.length > 0 ? 'text-red-600' : 'text-brand-green'}`}>
            {lowFeedAlerts.length}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{lowFeedAlerts.length > 0 ? 'Below threshold' : 'All healthy'}</p>
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

      {/* Brooder Tasks */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Today's Brooder Tasks</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {brooderTasks.map(({ label, sub, icon: Icon, color, route }) => (
            <button
              key={label}
              onClick={() => navigate(route)}
              className="w-full bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98] transition-all group"
            >
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

      {/* Production House Cage Map */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Production House — Cage Map</p>
        <div className="rounded-2xl overflow-hidden shadow-sm border border-dark-border" style={{ background: '#060c08' }}>
          <CageMap blockCode="BLK1" />
        </div>
      </div>

      {/* Brooder Cage Map */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Brooder — Live Map</p>
        <BrooderCageMap />
      </div>
    </div>
  );
}
