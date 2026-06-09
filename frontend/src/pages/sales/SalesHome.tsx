// src/pages/sales/SalesHome.tsx
// Grade-free: todaySold aggregation uses item.itemType only.
// Revenue progress section fixed: uses /sales/summary for expectedRevenue + todayRevenue.
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api/client';
import {
  ShoppingCart, BookOpen, Users, FileCheck, ChevronRight,
  EggOff, Truck, AlertTriangle, ArrowRight, RefreshCw, Package,
} from 'lucide-react';
import dayjs from 'dayjs';

const EGG_TYPE_LABELS: Record<string, string> = {
  STANDARD_EGGS:          'Standard Eggs',
  STARTER_EGGS:           'Starter Eggs',
  CONSUMABLE_BROKEN_EGGS: 'Consumable Broken Eggs',
};

function fmtKES(n: number) {
  if (n >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)    return `KES ${(n / 1_000).toFixed(1)}K`;
  return `KES ${n.toLocaleString()}`;
}
function eggsLabel(eggs: number) {
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
  const navigate   = useNavigate();
  const { user }   = useAuthStore();
  const hour       = dayjs().hour();
  const greeting   = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName  = user?.fullName?.split(' ')[0] ?? '';

  const { data: stock, isLoading: stockLoading } = useQuery({
    queryKey: ['sales-stock'],
    queryFn: () => api.get('/sales/stock').then(r => r.data).catch(() => null),
    staleTime: 2 * 60_000, refetchInterval: 5 * 60_000,
  });
  // Summary returns todayRevenue, expectedRevenue, revenueProgressPct — no grade field
  const { data: summary } = useQuery({
    queryKey: ['sales-summary'],
    queryFn: () => api.get('/sales/summary').then(r => r.data).catch(() => null),
    staleTime: 60_000,
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

  // Aggregate today's sold eggs by itemType — no grade field used
  const todaySold = (todayOrders as any[])
    .filter((o: any) => o.status !== 'CANCELLED')
    .reduce((acc: any, order: any) => {
      (order.items ?? []).forEach((item: any) => {
        const itemType = (item.itemType ?? '').toUpperCase();
        const qty = item.quantityEggs ?? (item.quantityTrays ? item.quantityTrays * 30 : 0);
        const rev = Number(item.subtotal ?? 0);
        if      (itemType.includes('STARTER'))           { acc.starter    += qty; acc.revenue += rev; }
        else if (itemType.includes('CONSUMABLE_BROKEN')) { acc.consumable += qty; acc.revenue += rev; }
        else                                              { acc.standard  += qty; acc.revenue += rev; }
      });
      return acc;
    }, { standard: 0, starter: 0, consumable: 0, revenue: 0 });

  const totalSoldEggs  = todaySold.standard + todaySold.starter + todaySold.consumable;
  const latestAdj      = (adjustments as any[])[0];

  // Payment method breakdown — aggregate across today's non-cancelled orders
  const paymentBreakdown = (todayOrders as any[])
    .filter((o: any) => o.status !== 'CANCELLED')
    .reduce((acc: Record<string, number>, order: any) => {
      const method = (order.paymentMethod ?? 'CASH').toUpperCase();
      const amount = Number(order.subtotal ?? 0);
      acc[method] = (acc[method] ?? 0) + amount;
      acc['TOTAL'] = (acc['TOTAL'] ?? 0) + amount;
      return acc;
    }, {} as Record<string, number>);
  const totalStockEggs = (stock?.standardEggs ?? 0) + (stock?.starterEggs ?? 0) + (stock?.consumableEggs ?? 0);

  const tasks = [
    { label: 'Orders',            sub: 'Create and manage egg sales orders',       icon: ShoppingCart, color: 'bg-brand-green', route: '/sales/orders',   badge: null },
    { label: 'Advance Bookings',  sub: 'Manage pre-orders and stock reservations', icon: BookOpen,     color: 'bg-brand-teal',  route: '/sales/bookings', badge: null },
    { label: 'Egg Breakage',      sub: 'Log broken egg reclassifications',         icon: EggOff,       color: 'bg-red-500',     route: '/sales/breakage', badge: null },
    { label: 'Delivery Tracking', sub: 'Track orders out for delivery',            icon: Truck,        color: 'bg-blue-500',    route: '/sales/delivery', badge: (deliveryCount as number) > 0 ? deliveryCount : null },
    { label: 'Clients',           sub: 'View and manage customer records',         icon: Users,        color: 'bg-purple-500',  route: '/sales/clients',  badge: null },
    { label: 'Egg Stock',         sub: 'View original & current egg inventory',    icon: Package,     color: 'bg-emerald-600', route: '/sales/egg-stock', badge: null },
    { label: 'Tally Verification',sub: 'Verify and confirm egg tally records',     icon: FileCheck,    color: 'bg-amber-500',   route: '/sales/tally',    badge: null },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      {/* Revenue Progress — from /sales/summary (expectedRevenue + todayRevenue) */}
      {summary && summary.expectedRevenue != null && summary.expectedRevenue > 0 && (() => {
        const expected  = Number(summary.expectedRevenue);
        const sold      = Number(summary.todayRevenue ?? 0);
        const remaining = Math.max(0, expected - sold);
        const pct       = Math.min(100, (sold / expected) * 100);
        return (
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Today's Revenue Target</p>
              <p className="text-xs text-gray-500">{pct.toFixed(0)}% reached</p>
            </div>
            <div className="w-full bg-gray-100 dark:bg-dark-bg rounded-full h-2.5 mb-2 overflow-hidden">
              <div className={`h-2.5 rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-brand-green' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">KES {sold.toLocaleString()} sold</span>
              <span className={`font-semibold ${remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                {remaining > 0 ? `KES ${remaining.toLocaleString()} remaining` : 'Target reached!'}
              </span>
              <span className="text-gray-500">Target: KES {expected.toLocaleString()}</span>
            </div>
          </div>
        );
      })()}

      {/* Greeting */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}! 👋</p>
        <p className="text-sm opacity-75 mt-0.5">Sales Dashboard</p>
      </div>

      {/* Egg Stock Overview */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Current Egg Stock</p>
          {stock?.tallyDate && (
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Last verified {dayjs(stock.tallyDate).format('D MMM')}
            </p>
          )}
        </div>
        {stockLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_,i) => <div key={i} className="rounded-2xl p-4 bg-gray-100 dark:bg-gray-800 animate-pulse h-20"/>)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatChip label="Standard Eggs"       value={(stock?.standardEggs  ?? 0).toLocaleString()} sub={eggsLabel(stock?.standardEggs  ?? 0)} color="text-brand-green"                    accent />
            <StatChip label="Starter Eggs"        value={(stock?.starterEggs   ?? 0).toLocaleString()} sub={eggsLabel(stock?.starterEggs   ?? 0)} color="text-blue-600 dark:text-blue-400" />
            <StatChip label="Consumable Broken"   value={(stock?.consumableEggs ?? 0).toLocaleString()} sub={eggsLabel(stock?.consumableEggs ?? 0)} color="text-amber-600 dark:text-amber-400" />
            <StatChip label="Total Available"     value={totalStockEggs.toLocaleString()}              sub={eggsLabel(totalStockEggs)}             color="text-gray-800 dark:text-gray-100" />
          </div>
        )}
        {(stock?.nonConsumableEggs ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{(stock?.nonConsumableEggs ?? 0).toLocaleString()} non-consumable broken eggs recorded — not included in available stock</span>
          </div>
        )}
        {!stock?.pricing && (
          <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>No pricing set today — contact accountant to set egg prices before creating orders.</span>
          </div>
        )}
      </div>

      {/* Today's Sales — uses itemType not grade */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Today's Sales</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatChip label="Standard Sold"          value={todaySold.standard.toLocaleString()}   sub={eggsLabel(todaySold.standard)}   color="text-brand-green" />
          <StatChip label="Starter Sold"           value={todaySold.starter.toLocaleString()}    sub={eggsLabel(todaySold.starter)}    color="text-blue-600 dark:text-blue-400" />
          <StatChip label="Consumable Broken Sold" value={todaySold.consumable.toLocaleString()} sub={eggsLabel(todaySold.consumable)} color="text-amber-600 dark:text-amber-400" />
          <StatChip label="Today's Revenue"        value={fmtKES(todaySold.revenue)} sub={`${totalSoldEggs.toLocaleString()} eggs sold`} color="text-brand-green" accent />
        </div>
      </div>

      {/* Payment Method Breakdown */}
      {paymentBreakdown['TOTAL'] > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Today's Payments by Method</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatChip label="Cash" value={fmtKES(paymentBreakdown['CASH'] ?? 0)} color="text-brand-green" />
            <StatChip label="M-Pesa" value={fmtKES(paymentBreakdown['MPESA'] ?? 0)} color="text-blue-600 dark:text-blue-400" />
            <StatChip label="Bank Transfer" value={fmtKES(paymentBreakdown['BANK'] ?? 0)} color="text-purple-600 dark:text-purple-400" />
            <StatChip label="Total Collected" value={fmtKES(paymentBreakdown['TOTAL'] ?? 0)} color="text-brand-green" accent />
          </div>
        </div>
      )}

      {/* Latest Breakage Adjustment */}
      {latestAdj && (
        <button onClick={() => navigate('/sales/breakage')}
          className="w-full bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-2xl px-4 py-3 flex items-center justify-between text-left hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
          <div className="flex items-start gap-3">
            <EggOff className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">Last Adjustment: {latestAdj.adjustmentRef}</p>
              <p className="text-xs text-red-500 dark:text-red-500 mt-0.5">
                {dayjs(latestAdj.adjustmentDate).format('D MMM YYYY')} · {latestAdj.adjustmentType === 'NON_CONSUMABLE' ? 'Non-Consumable' : 'Consumable'} · Diff: {latestAdj.quantityDiff > 0 ? `+${latestAdj.quantityDiff}` : latestAdj.quantityDiff} eggs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400 font-medium flex-shrink-0">View all <ArrowRight className="w-3 h-3"/></div>
        </button>
      )}

      {/* Tasks */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Today's Tasks</p>
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
