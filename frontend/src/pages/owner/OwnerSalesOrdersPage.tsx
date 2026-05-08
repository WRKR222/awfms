// src/pages/owner/OwnerSalesOrdersPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';
import {
  ArrowLeft, TrendingUp, Egg, DollarSign,
  CheckCircle, Clock, Package,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SalesOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  quantityEggs?: number;
  trays?: number;
  pricePerEggKes?: number;
  totalAmountKes: number;
  status: string;
  createdAt: string;
}

interface PricingToday {
  pricePerEggProduction?: number;
  pricePerEggStarter?: number;
  pricePerEggBroken?: number;
  expectedRevenue?: number;
}

// ── Status colours ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  CONFIRMED: {
    label: 'Confirmed',
    cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    icon: <CheckCircle className="w-3 h-3" />,
  },
  PENDING: {
    label: 'Pending',
    cls: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    icon: <Clock className="w-3 h-3" />,
  },
  DRAFT: {
    label: 'Draft',
    cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    icon: <Package className="w-3 h-3" />,
  },
};

// ── Revenue progress bar ───────────────────────────────────────────────────────
function RevenueProgress({
  realised,
  expected,
}: {
  realised: number;
  expected: number;
}) {
  const pct = expected > 0 ? Math.min(100, (realised / expected) * 100) : 0;
  const remaining = Math.max(0, expected - realised);
  const color =
    pct >= 90 ? 'bg-green-500' : pct >= 60 ? 'bg-brand-green' : pct >= 30 ? 'bg-yellow-400' : 'bg-red-400';

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mb-1">
            Revenue Progress
          </p>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
            KES {realised.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            of{' '}
            <span className="font-semibold text-gray-600 dark:text-gray-300">
              KES {expected.toLocaleString()}
            </span>{' '}
            expected
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-brand-green">{pct.toFixed(1)}%</p>
          <p className="text-xs text-gray-400">realised</p>
        </div>
      </div>
      <div className="bg-gray-100 dark:bg-dark-border rounded-full h-3 overflow-hidden">
        <div
          className={`h-3 rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>KES {remaining.toLocaleString()} remaining</span>
        <span>{pct >= 100 ? '🎉 Target reached!' : `${(100 - pct).toFixed(1)}% to go`}</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function OwnerSalesOrdersPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // All sales orders
  const { data: orders = [], isLoading } = useQuery<SalesOrder[]>({
    queryKey: ['owner-sales-orders'],
    queryFn: () => api.get('/sales/orders').then(r => r.data),
    staleTime: 30_000,
  });

  // Today's pricing for expected revenue
  const { data: pricing } = useQuery<PricingToday>({
    queryKey: ['pricing-today'],
    queryFn: () => api.get('/pricing/daily/today').then(r => r.data).catch(() => ({})),
    staleTime: 60_000,
  });

  // Compute totals
  const confirmedOrders = orders.filter(o => o.status === 'CONFIRMED');
  const totalRealised = confirmedOrders.reduce(
    (sum, o) => sum + (o.totalAmountKes ?? 0),
    0
  );
  const expectedRevenue = pricing?.expectedRevenue ?? 0;

  const filtered = statusFilter
    ? orders.filter(o => o.status === statusFilter)
    : orders;

  // KPI cards
  const totalEggs = confirmedOrders.reduce(
    (sum, o) => sum + (o.quantityEggs ?? (o.trays ? o.trays * 30 : 0)),
    0
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark-bg">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white dark:bg-dark-card border-b border-gray-100 dark:border-dark-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">Sales Orders</h1>
          <p className="text-xs text-gray-400">{orders.length} orders total</p>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-3xl mx-auto">

        {/* Revenue progress */}
        <RevenueProgress realised={totalRealised} expected={expectedRevenue} />

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign className="w-3.5 h-3.5 text-brand-green" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Confirmed</p>
            </div>
            <p className="text-lg font-bold text-gray-800 dark:text-gray-100">
              KES {(totalRealised / 1000).toFixed(1)}<span className="text-xs font-normal text-gray-400 ml-0.5">K</span>
            </p>
          </div>
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Egg className="w-3.5 h-3.5 text-amber-500" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Eggs Sold</p>
            </div>
            <p className="text-lg font-bold text-gray-800 dark:text-gray-100">
              {totalEggs.toLocaleString()}
            </p>
          </div>
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-purple-500" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Orders</p>
            </div>
            <p className="text-lg font-bold text-gray-800 dark:text-gray-100">
              {confirmedOrders.length}
              <span className="text-xs font-normal text-gray-400 ml-1">confirmed</span>
            </p>
          </div>
        </div>

        {/* Status filter pills */}
        <div className="flex gap-2 flex-wrap">
          {[null, 'CONFIRMED', 'PENDING', 'DRAFT'].map(s => (
            <button
              key={s ?? 'all'}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === s
                  ? 'bg-brand-green text-white'
                  : 'bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 hover:bg-gray-50'
              }`}
            >
              {s === null ? `All (${orders.length})` : `${STATUS_CONFIG[s]?.label ?? s} (${orders.filter(o => o.status === s).length})`}
            </button>
          ))}
        </div>

        {/* Orders list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white dark:bg-dark-card rounded-2xl h-20 animate-pulse border border-gray-100 dark:border-dark-border" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Package className="w-12 h-12 mx-auto mb-3 text-gray-200 dark:text-gray-600" />
            <p className="text-gray-400 font-medium">No orders found</p>
            <p className="text-sm text-gray-300 dark:text-gray-600 mt-1">
              {statusFilter ? `No ${STATUS_CONFIG[statusFilter]?.label} orders` : 'No sales orders yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(order => {
              const sc = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.DRAFT;
              const eggs = order.quantityEggs ?? (order.trays ? order.trays * 30 : 0);
              return (
                <div
                  key={order.id}
                  className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-3.5 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                        {order.customerName}
                      </p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 flex-shrink-0 ${sc.cls}`}>
                        {sc.icon}
                        {sc.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {order.orderNumber} · {eggs.toLocaleString()} eggs
                      {order.trays ? ` (${order.trays} trays)` : ''} ·{' '}
                      {dayjs(order.createdAt).format('D MMM YYYY')}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-brand-green flex-shrink-0">
                    KES {(order.totalAmountKes ?? 0).toLocaleString()}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
