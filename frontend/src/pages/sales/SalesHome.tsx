// src/pages/sales/SalesHome.tsx
// IMPLEMENTATION PLAN CHANGES:
//   • Stock panel now reads from /production/daily-aggregate (DailyEggAggregate)
//     instead of /sales/stock for the primary egg count cards.
//   • Four stock cards: Standard Eggs, Starter Eggs, Broken Sellable, Broken Unsellable.
//   • Broken Unsellable card always renders at 0 with tooltip until breakage adjustments are recorded.
//   • Expected revenue block shown below the stock cards.
//   • Original /sales/stock query retained for legacy data and the existing broken egg warning.
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api/client';
import {
  ShoppingCart, BookOpen, Users, FileCheck, ChevronRight,
  EggOff, Truck, AlertTriangle, ArrowRight, RefreshCw, Package,
  Info,
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

function StatChip({ label, value, sub, color = 'text-gray-800 dark:text-gray-100', accent = false, tooltip }:
  { label: string; value: string; sub?: string; color?: string; accent?: boolean; tooltip?: string }) {
  return (
    <div className={`rounded-2xl p-3 md:p-4 border ${accent ? 'bg-brand-green/5 dark:bg-brand-green/10 border-brand-green/20' : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border'} text-left relative group`}>
      <div className="flex items-center gap-1 mb-0.5">
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        {tooltip && (
          <div className="relative">
            <Info className="w-3 h-3 text-gray-400 cursor-help" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 bg-gray-800 text-white text-[10px] rounded-lg px-2 py-1.5 hidden group-hover:block z-10 pointer-events-none">
              {tooltip}
            </div>
          </div>
        )}
      </div>
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

  // Aggregate from DailyEggAggregate (written on tally lock) — fallback source
  const { data: aggregate } = useQuery({
    queryKey: ['daily-aggregate'],
    queryFn: () =>
      api.get(`/production/daily-aggregate?date=${dayjs().format('YYYY-MM-DD')}`).then(r => r.data).catch(() => null),
    staleTime: 2 * 60_000,
    refetchInterval: 60_000,
  });

  // Primary live stock source — already reflects breakage adjustments
  // (newStandard / newConsumable / newNonConsumable), sold orders, and
  // locked advance bookings. Polled so the dashboard updates shortly after
  // a breakage adjustment is submitted on the Egg Breakage page.
  const { data: stock, isLoading: stockLoading } = useQuery({
    queryKey: ['sales-stock'],
    queryFn: () => api.get('/sales/stock').then(r => r.data).catch(() => null),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

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

  const paymentBreakdown = (todayOrders as any[])
    .filter((o: any) => o.status !== 'CANCELLED')
    .reduce((acc: Record<string, number>, order: any) => {
      const method = (order.paymentMethod ?? 'CASH').toUpperCase();
      const amount = Number(order.subtotal ?? 0);
      acc[method] = (acc[method] ?? 0) + amount;
      acc['TOTAL'] = (acc['TOTAL'] ?? 0) + amount;
      return acc;
    }, {} as Record<string, number>);

  // Stock values — prefer /sales/stock since it already applies breakage
  // adjustments (newStandard / newConsumable / newNonConsumable) plus sold
  // and locked-booking deductions. Fall back to the raw DailyEggAggregate
  // only when /sales/stock has no data yet (e.g. before first tally lock).
  // FIX: previously aggregate was read FIRST, which meant breakage adjustments
  // never showed up here once an aggregate existed for the day.
  const stdEggs          = stock?.standardEggs      ?? aggregate?.totalStdEggs         ?? 0;
  const starterEggs      = aggregate?.totalStarterEggs ?? stock?.starterEggs           ?? 0;
  const brokenSellable   = stock?.consumableEggs    ?? aggregate?.totalBrokenSellable  ?? 0;
  const brokenUnsellable = stock?.nonConsumableEggs ?? aggregate?.totalBrokenUnsellable ?? 0;
  const expectedRevenue  = stock?.expectedRevenueKes ?? (aggregate ? Number(aggregate.expectedRevenueKes ?? 0) : null);
  const aggregateDate    = stock?.lastVerifiedDate  ?? aggregate?.aggregateDate ?? null;

  const pricing = stock?.pricing ?? aggregate?.pricing ?? null;

  const { data: pendingTallies = [] } = useQuery({
    queryKey: ['tally-pending'],
    queryFn: () => api.get('/tally-verifications/pending').then(r => r.data as any[]).catch(() => []),
    staleTime: 30_000,
  });
  const pendingTallyCount = (pendingTallies as any[]).filter(
    (t: any) => !t.salesSignedById && !t.isLocked && t.pmSignedById
  ).length;

  const tasks = [
    { label: 'Orders',            sub: 'Create and manage egg sales orders',       icon: ShoppingCart, color: 'bg-brand-green', route: '/sales/orders',   badge: null },
    { label: 'Advance Bookings',  sub: 'Manage pre-orders and stock reservations', icon: BookOpen,     color: 'bg-brand-teal',  route: '/sales/bookings', badge: null },
    { label: 'Egg Breakage',      sub: 'Log broken egg reclassifications',         icon: EggOff,       color: 'bg-red-500',     route: '/sales/breakage', badge: null },
    { label: 'Delivery Tracking', sub: 'Track orders out for delivery',            icon: Truck,        color: 'bg-blue-500',    route: '/sales/delivery', badge: (deliveryCount as number) > 0 ? deliveryCount : null },
    { label: 'Clients',           sub: 'View and manage customer records',         icon: Users,        color: 'bg-purple-500',  route: '/sales/clients',  badge: null },
    { label: 'Egg Stock',         sub: 'View original & current egg inventory',    icon: Package,     color: 'bg-emerald-600', route: '/sales/egg-stock', badge: null },
    // FIX: Show pending tally count badge on the Tally Verification task card
    { label: 'Tally Verification',sub: 'Verify and confirm egg tally records',     icon: FileCheck,    color: 'bg-amber-500',   route: '/sales/tally',    badge: pendingTallyCount > 0 ? pendingTallyCount : null },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      {/* Revenue Progress */}
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

      {/* Egg Stock Overview — from DailyEggAggregate */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Current Egg Stock</p>
          {aggregateDate && (
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Last verified {dayjs(aggregateDate).format('D MMM')}
            </p>
          )}
        </div>
        {stockLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_,i) => <div key={i} className="rounded-2xl p-4 bg-gray-100 dark:bg-gray-800 animate-pulse h-20"/>)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatChip
              label="Standard Eggs"
              value={stdEggs.toLocaleString()}
              sub={eggsLabel(stdEggs)}
              color="text-brand-green"
              accent
            />
            {/* FIX: Show Starter Eggs card whenever count > 0 from either aggregate or stock.
                Previously only rendered when aggregate object was truthy, which hid the card
                when only AM session was complete and aggregate hadn't been written yet. */}
            {starterEggs > 0 && (
              <StatChip
                label="Starter Eggs"
                value={starterEggs.toLocaleString()}
                sub={eggsLabel(starterEggs)}
                color="text-blue-600 dark:text-blue-400"
              />
            )}
            <StatChip
              label="Broken Sellable"
              value={brokenSellable.toLocaleString()}
              sub={eggsLabel(brokenSellable)}
              color="text-amber-600 dark:text-amber-400"
            />
            <StatChip
              label="Broken Unsellable"
              value={brokenUnsellable.toLocaleString()}
              sub={brokenUnsellable > 0 ? eggsLabel(brokenUnsellable) : 'None recorded'}
              color={brokenUnsellable > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}
              tooltip="Excluded from available stock. Updates instantly when an egg breakage adjustment is submitted."
            />
          </div>
        )}

        {/* Expected Revenue block */}
        {expectedRevenue !== null && expectedRevenue > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 mt-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Expected Revenue (today)</p>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-400">
              KES {expectedRevenue.toLocaleString()}
            </p>
            {pricing && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                Std × KES {Number(pricing.pricePerEgg).toFixed(2)}
                {pricing.pricePerEggStarter != null && ` + Starter × KES ${Number(pricing.pricePerEggStarter).toFixed(2)}`}
                {pricing.pricePerEggBroken  != null && ` + Broken Sellable × KES ${Number(pricing.pricePerEggBroken).toFixed(2)}`}
              </p>
            )}
          </div>
        )}

        {!stock?.pricing && (
          <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>No pricing set today — contact accountant to set egg prices before creating orders.</span>
          </div>
        )}
      </div>

      {/* Today's Sales */}
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
