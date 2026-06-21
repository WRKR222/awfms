// src/pages/owner/OwnerSalesOrdersPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';
import {
  ArrowLeft, TrendingUp, Egg, DollarSign,
  CheckCircle, Clock, Package,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SalesOrderItem {
  itemType: string;
  quantityEggs?: number | null;
  quantityTrays?: number | null;
  subtotal: number;
}

interface SalesOrder {
  id: string;
  orderNumber: string;
  customer: { id: string; name: string; phone?: string };
  items: SalesOrderItem[];
  subtotal: number;
  status: string;
  orderDate: string;
  createdAt: string;
  paymentMethod?: string;
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

  // Use /sales/stock for expectedRevenueKes — this is the computed tally × pricing
  // figure, not the accountant's manually entered estimate on DailyEggPrice.
  const { data: stock } = useQuery({
    queryKey: ['sales-stock'],
    queryFn: () => api.get('/sales/stock').then(r => r.data).catch(() => null),
    staleTime: 60_000,
  });

  // Realised = sum of subtotals for active (non-cancelled) orders
  const activeOrders = orders.filter(o => o.status !== 'CANCELLED');
  const confirmedOrders = orders.filter(
    o => o.status === 'CONFIRMED' || o.status === 'DELIVERING' || o.status === 'DELIVERED'
  );
  const totalRealised = confirmedOrders.reduce(
    (sum, o) => sum + Number(o.subtotal ?? 0), 0
  );
  const expectedRevenue = stock?.expectedRevenueKes ?? 0;

  const filtered = statusFilter
    ? orders.filter(o => o.status === statusFilter)
    : orders;

  // Eggs sold — sum across all item types in confirmed/delivered orders
  const totalEggs = confirmedOrders.reduce((sum, o) =>
    sum + o.items.reduce((s, i) =>
      s + (i.quantityEggs ?? (i.quantityTrays ?? 0) * 30), 0), 0
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
          {([null, 'CONFIRMED', 'PENDING', 'DRAFT', 'DELIVERING', 'DELIVERED', 'CANCELLED'] as (string | null)[]).map(s => (
            <button
              key={s ?? 'all'}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === s
                  ? 'bg-brand-green text-white'
                  : 'bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 hover:bg-gray-50'
              }`}
            >
              {s === null ? `All (${orders.length})` : `${STATUS_CONFIG[s]?.label ?? s.charAt(0)+s.slice(1).toLowerCase()} (${orders.filter(o => o.status === s).length})`}
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
              const eggs = order.items?.reduce((s, i) => s + (i.quantityEggs ?? (i.quantityTrays ?? 0) * 30), 0) ?? 0;
              return (
                <div
                  key={order.id}
                  className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-3.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                          {order.customer.name}
                        </p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 flex-shrink-0 ${sc.cls}`}>
                          {sc.icon}
                          {sc.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {order.orderNumber} · {eggs.toLocaleString()} eggs ·{' '}
                        {dayjs(order.orderDate ?? order.createdAt).format('D MMM YYYY')}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-brand-green flex-shrink-0">
                      KES {Number(order.subtotal ?? 0).toLocaleString()}
                    </p>
                  </div>
                  {order.items?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-50 dark:border-dark-border">
                      {order.items.filter(item => (item.quantityEggs ?? (item.quantityTrays ?? 0) * 30) > 0).map((item, idx) => {
                        const eggQty = item.quantityEggs ?? (item.quantityTrays ?? 0) * 30;
                        const label =
                          item.itemType === 'STANDARD_EGGS'          ? 'standard' :
                          item.itemType === 'STARTER_EGGS'            ? 'starter' :
                          item.itemType === 'CONSUMABLE_BROKEN_EGGS'  ? 'broken sellable' : item.itemType;
                        const color =
                          item.itemType === 'STANDARD_EGGS'          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' :
                          item.itemType === 'STARTER_EGGS'            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' :
                          'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400';
                        return (
                          <span key={idx} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${color}`}>
                            {eggQty.toLocaleString()} {label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
