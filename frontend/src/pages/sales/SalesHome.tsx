// src/pages/sales/SalesHome.tsx
// Enhanced with: egg stock dashboard, today\u2019s sales breakdown, adjustment tracker
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api/client';
import {
  ShoppingCart, BookOpen, Users, FileCheck, ChevronRight,
  EggOff, Truck, Package, TrendingUp, AlertTriangle,
  ArrowRight, RefreshCw
} from 'lucide-react';
import dayjs from 'dayjs';

function fmtKES(n: number) {
  if (n >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)    return `KES ${(n / 1_000).toFixed(1)}K`;
  return `KES ${n.toLocaleString()}`;
}
function traysLabel(eggs: number) {
  const t = Math.floor(eggs / 30), r = eggs % 30;
  if (!eggs) return '0 eggs';
  if (t === 0) return `${r} egg${r !== 1 ? 's' : ''}`;
  if (r === 0) return `${t} tray${t !== 1 ? 's' : ''}`;
  return `${t} tray${t !== 1 ? 's' : ''} + ${r}`;
}

function StatChip({ label, value, sub, color = 'text-gray-800 dark:text-gray-100', accent = false }:
  { label: string; value: string; sub?: string; color?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 md:p-4 border ${accent ? 'bg-brand-green/5 dark:bg-brand-green/10 border-brand-green/20' : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border'} text-left`}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</p>
      <p className={`text-lg md:text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function SalesHome() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  const { data: stock, isLoading: stockLoading } = useQuery({
    queryKey: ['sales-stock'],
    queryFn: () => api.get('/sales/stock').then(r => r.data).catch(() => null),
    staleTime: 2 * 60_000, refetchInterval: 5 * 60_000,
  });
  const { data: todayOrders = [] } = useQuery({
    queryKey: ['sales-orders-today'],
    queryFn: () => api.get('/sales/orders?days=1').then(r => r.data).catch(() => []),
    staleTime: 60_000,
  });
  const { data: adjustments = [] } = useQuery({
    queryKey: ['breakage-adjustments'],
    queryFn: () => api.get('/sales/breakage-adjustments').then(r => r.data).catch(() => []),
    staleTime: 2 * 60_000,
  });
  const { data: deliveryCount = 0 } = useQuery({
    queryKey: ['delivery-count'],
    queryFn: () => api.get('/sales/orders?status=DELIVERING&days=90').then(r => (r.data as any[]).length).catch(() => 0),
  });

  const todaySold = (todayOrders as any[])
    .filter((o: any) => o.status !== 'CANCELLED')
    .reduce((acc: any, order: any) => {
      (order.items ?? []).forEach((item: any) => {
        const grade = (item.grade ?? item.itemType ?? '').toUpperCase();
        const qty = item.quantityTrays ? item.quantityTrays * 30 : 0;
        const rev = Number(item.subtotal ?? 0);
        if (grade.includes('STARTER'))                             { acc.starter += qty; acc.revenue += rev; }
        else if (grade.includes('CONSUMABLE') || grade.includes('BROKEN')) { acc.consumable += qty; acc.revenue += rev; }
        else                                                        { acc.normal += qty; acc.revenue += rev; }
      });
      return acc;
    }, { normal: 0, starter: 0, consumable: 0, revenue: 0 });

  const totalSoldEggs  = todaySold.normal + todaySold.starter + todaySold.consumable;
  const latestAdj      = (adjustments as any[])[0];
  const totalStockEggs = (stock?.standardEggs ?? 0) + (stock?.starterEggs ?? 0) + (stock?.consumableEggs ?? 0);

  const tasks = [
    { label: 'Orders',            sub: 'Create and manage egg sales orders',    icon: ShoppingCart, color: 'bg-brand-green',  route: '/sales/orders',   badge: null },
    { label: 'Advance Bookings',  sub: 'Manage pre-orders and reservations',    icon: BookOpen,     color: 'bg-brand-teal',   route: '/sales/bookings', badge: null },
    { label: 'Egg Breakage',      sub: 'Log broken egg reclassifications',      icon: EggOff,       color: 'bg-red-500',      route: '/sales/breakage', badge: null },
    { label: 'Delivery Tracking', sub: 'Track orders currently out for delivery', icon: Truck,      color: 'bg-blue-500',     route: '/sales/delivery', badge: (deliveryCount as number) > 0 ? deliveryCount : null },
    { label: 'Clients',           sub: 'View and manage customer records',      icon: Users,        color: 'bg-purple-500',   route: '/sales/clients',  badge: null },
    { label: 'Tally Verification',sub: 'Verify and confirm egg tally records',  icon: FileCheck,    color: 'bg-amber-500',    route: '/sales/tally',    badge: null },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY \u00b7 {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}! \ud83d\udc4b</p>
        <p className="text-sm opacity-75 mt-0.5">Sales Dashboard</p>
      </div>

      {/* Egg Stock Overview */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Current Egg Stock</p>
          {stock?.lastVerifiedDate && (
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Last verified {dayjs(stock.lastVerifiedDate).format('D MMM')}
            </p>
          )}
        </div>
        {stockLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_,i) => <div key={i} className="rounded-2xl p-4 bg-gray-100 dark:bg-gray-800 animate-pulse h-20"/>)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatChip label="Normal Eggs"     value={(stock?.standardEggs  ?? 0).toLocaleString()} sub={traysLabel(stock?.standardEggs  ?? 0)} color="text-brand-green"                    accent />
            <StatChip label="Starter Eggs"    value={(stock?.starterEggs   ?? 0).toLocaleString()} sub={traysLabel(stock?.starterEggs   ?? 0)} color="text-blue-600 dark:text-blue-400" />
            <StatChip label="Broken Sellable" value={(stock?.consumableEggs ?? 0).toLocaleString()} sub={traysLabel(stock?.consumableEggs ?? 0)} color="text-amber-600 dark:text-amber-400" />
            <StatChip label="Total Available" value={totalStockEggs.toLocaleString()}              sub={traysLabel(totalStockEggs)}             color="text-gray-800 dark:text-gray-100" />
          </div>
        )}
        {(stock?.nonConsumableEggs ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{stock.nonConsumableEggs.toLocaleString()} broken unsellable eggs recorded \u2014 not included in available stock</span>
          </div>
        )}
      </div>

      {/* Today\u2019s Sales */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Today\u2019s Sales</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatChip label="Normal Sold"        value={todaySold.normal.toLocaleString()}    sub={traysLabel(todaySold.normal)}    color="text-brand-green" />
          <StatChip label="Starter Sold"       value={todaySold.starter.toLocaleString()}   sub={traysLabel(todaySold.starter)}   color="text-blue-600 dark:text-blue-400" />
          <StatChip label="Broken Sellable Sold" value={todaySold.consumable.toLocaleString()} sub={traysLabel(todaySold.consumable)} color="text-amber-600 dark:text-amber-400" />
          <StatChip label="Today\u2019s Revenue" value={fmtKES(todaySold.revenue)} sub={`${totalSoldEggs.toLocaleString()} eggs sold`} color="text-brand-green" accent />
        </div>
      </div>

      {/* Latest Adjustment */}
      {latestAdj && (
        <button onClick={() => navigate('/sales/breakage')}
          className="w-full bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-2xl px-4 py-3 flex items-center justify-between text-left hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
          <div className="flex items-start gap-3">
            <EggOff className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">Last Adjustment: {latestAdj.adjustmentRef}</p>
              <p className="text-xs text-red-500 dark:text-red-500 mt-0.5">
                {dayjs(latestAdj.adjustmentDate).format('D MMM YYYY')} \u00b7 {latestAdj.adjustmentType === 'NON_CONSUMABLE' ? 'Non-Consumable' : 'Consumable'} \u00b7 Diff: {latestAdj.quantityDiff > 0 ? `+${latestAdj.quantityDiff}` : latestAdj.quantityDiff} eggs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400 font-medium flex-shrink-0">View all <ArrowRight className="w-3 h-3"/></div>
        </button>
      )}

      {/* Tasks */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Today\u2019s Tasks</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tasks.map(({ label, sub, icon: Icon, color, route, badge }) => (
            <button key={route} onClick={() => navigate(route)}
              className="w-full bg-white dark:bg-dark-card rounded-2xl p-4 md:p-5 shadow-sm border border-gray-100 dark:border-dark-border flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98] transition-all group relative">
              {badge != null && (badge as number) > 0 && (
                <span className="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{badge as number}</span>
              )}
              <div className={`w-14 h-14 ${color} rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}><Icon className="w-7 h-7 text-white"/></div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-800 dark:text-gray-100 text-base">{label}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all"/>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
