// frontend/src/pages/accountant/AccountantHome.tsx
// Fixes applied:
//   GAP-10: api import path corrected (../../lib/api → ../../lib/api/client)
//   GAP-10: invoice query fixed (/invoices?status=PAID → /finance/invoices?status=PAID)
//   GAP-03: finance summary now hits correct /finance/summary endpoint
//   GAP-15: LPO task card added (with pending PR count badge)
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, CheckCircle, XCircle, AlertTriangle,
         DollarSign, Tag, ClipboardList } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';           // GAP-10 FIX: was ../../lib/api
import { useAuthStore } from '../../stores/auth.store';
import dayjs from '../../lib/dayjs';

type AnyInvoiceStatus = 'PAID' | 'OVERDUE' | 'UNPAID' | 'PARTIAL';

interface Invoice {
  id: string;
  invoiceNumber: string;
  customer: { name: string };
  totalAmount: number;
  balanceDue: number;
  status: AnyInvoiceStatus;
  dueDate: string;
  createdAt: string;
}

const STATUS_CFG: Record<AnyInvoiceStatus, { label: string; color: string; icon: typeof CheckCircle }> = {
  PAID:    { label: 'Paid',    color: 'bg-green-100 text-green-700',  icon: CheckCircle },
  OVERDUE: { label: 'Overdue', color: 'bg-red-100 text-red-700',      icon: XCircle },
  UNPAID:  { label: 'Unpaid',  color: 'bg-amber-100 text-amber-700',  icon: AlertTriangle },
  PARTIAL: { label: 'Partial', color: 'bg-blue-100 text-blue-700',    icon: AlertCircle },
};

function useRecentInvoices() {
  return useQuery({
    queryKey: ['accountant-home-invoices'],
    queryFn: async () => {
      // GAP-10 FIX: correct path is /finance/invoices not /invoices
      const res = await api.get('/finance/invoices');
      return (res.data as Invoice[]).slice(0, 6);
    },
    staleTime: 30_000,
  });
}

function useFinanceSummary() {
  return useQuery({
    queryKey: ['finance-summary'],
    queryFn: async () => {
      // GAP-03 FIX: /finance/summary now exists (added to finance.controller.ts)
      const res = await api.get('/finance/summary');
      return res.data as {
        paidThisMonth: number;
        totalInvoices: number;
        pendingPriceSet: boolean;
        pendingPRCount: number;     // now counts pending issuance plans (was: pending purchase requests)
      };
    },
    staleTime: 60_000,
  });
}

export function AccountantHome() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: invoices = [], isLoading } = useRecentInvoices();
  const { data: summary } = useFinanceSummary();

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  const tasks = [
    {
      label: 'Finance',
      sub: 'Invoices, expenses, AR & reports',
      icon: DollarSign,
      color: 'bg-brand-green',
      route: '/accountant/finance',
      badge: null,
    },
    {
      label: 'Pricing',
      sub: "Set today's egg prices per category",
      icon: Tag,
      color: 'bg-amber-500',
      route: '/accountant/pricing',
      badge: summary?.pendingPriceSet ? '!' : null,
      alert: summary?.pendingPriceSet,
    },
    // Issuance Plans card — Accountant's core daily/weekly approval task
    {
      label: 'Issuance Plans',
      sub: 'Review and approve weekly & emergency issuance plans',
      icon: ClipboardList,
      color: 'bg-purple-500',
      route: '/accountant/issuance-plans',
      badge: summary?.pendingPRCount && summary.pendingPRCount > 0
        ? summary.pendingPRCount
        : null,
    },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      {/* Greeting banner */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}!</p>
        <p className="text-sm opacity-75 mt-0.5">Accountant Dashboard</p>
      </div>

      {/* Pricing alert */}
      {summary?.pendingPriceSet && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            Egg prices have not been set yet today — Sales cannot create orders until prices are set.
          </p>
        </div>
      )}

      {/* Pending issuance plan alert */}
      {(summary?.pendingPRCount ?? 0) > 0 && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-2xl px-4 py-3 flex items-center gap-3">
          <ClipboardList className="w-5 h-5 text-purple-600 flex-shrink-0" />
          <p className="text-sm font-semibold text-purple-700 dark:text-purple-400">
            {summary?.pendingPRCount} issuance plan{(summary?.pendingPRCount ?? 0) > 1 ? 's' : ''} awaiting your approval before they go to the Director.
          </p>
        </div>
      )}

      {/* Task cards */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Today's Tasks
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tasks.map(({ label, sub, icon: Icon, color, route, badge, alert }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border flex flex-col items-start gap-3 hover:shadow-md active:scale-[0.98] transition-all group relative text-left"
            >
              {badge && (
                <span className={`absolute top-2 right-2 min-w-[20px] h-5 flex items-center justify-center rounded-full text-white text-[10px] font-bold px-1.5 ${alert ? 'bg-amber-500' : 'bg-purple-500'}`}>
                  {badge}
                </span>
              )}
              <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">{label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Finance summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Paid This Month</p>
          <p className="text-xl font-bold text-brand-green">
            {summary ? `KES ${(summary.paidThisMonth / 1000).toFixed(1)}K` : '—'}
          </p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Invoices</p>
          <p className="text-xl font-bold text-gray-800 dark:text-gray-100">
            {summary?.totalInvoices ?? invoices.length}
          </p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Pending Issuance Plans</p>
          <p className={`text-xl font-bold ${(summary?.pendingPRCount ?? 0) > 0 ? 'text-purple-600' : 'text-gray-800 dark:text-gray-100'}`}>
            {summary?.pendingPRCount ?? 0}
          </p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Price Set Today</p>
          <p className={`text-xl font-bold ${summary?.pendingPriceSet ? 'text-amber-500' : 'text-brand-green'}`}>
            {summary === undefined ? '—' : summary.pendingPriceSet ? 'No' : 'Yes'}
          </p>
        </div>
      </div>

      {/* Recent invoices — shows all statuses, not just PAID */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
            Recent Invoices
          </p>
          <button
            onClick={() => navigate('/accountant/finance')}
            className="text-xs text-brand-green font-medium hover:underline flex items-center gap-1"
          >
            View all <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No invoices found</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {invoices.map((inv: any) => {
              const cfg = STATUS_CFG[inv.status as AnyInvoiceStatus] ?? STATUS_CFG.UNPAID;
              const StatusIcon = cfg.icon;
              return (
                <div key={inv.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4 flex items-center gap-3">
                  <StatusIcon className={`w-5 h-5 flex-shrink-0 ${
                    inv.status === 'PAID'    ? 'text-green-500'  :
                    inv.status === 'OVERDUE' ? 'text-red-500'    :
                    inv.status === 'PARTIAL' ? 'text-blue-500'   : 'text-amber-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm truncate">
                        {inv.customer?.name}
                      </p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {inv.invoiceNumber} · Due {dayjs(inv.dueDate).format('D MMM YYYY')}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-200">
                      KES {Number(inv.totalAmount).toLocaleString()}
                    </p>
                    {inv.balanceDue > 0 && (
                      <p className="text-xs text-red-500">
                        Balance: KES {Number(inv.balanceDue).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
