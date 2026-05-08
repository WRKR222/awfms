import { useState } from 'react';
import { AlertCircle, ChevronRight, CheckCircle, Clock, XCircle, DollarSign, Tag, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

type InvoiceStatus = 'PAID' | 'OVERDUE';

interface Invoice {
  id: string;
  invoiceNumber: string;
  customer: { name: string };
  totalAmountKes: number;
  balanceKes: number;
  status: InvoiceStatus;
  dueDate: string;
  issuedAt: string;
  daysOverdue?: number;
}

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; icon: typeof CheckCircle }> = {
  PAID:    { label: 'Paid',    color: 'bg-green-100 text-green-700',  icon: CheckCircle },
  OVERDUE: { label: 'Overdue', color: 'bg-red-100 text-red-700',      icon: XCircle },
};

function useInvoices() {
  return useQuery({
    queryKey: ['invoices', 'PAID'],
    queryFn: async () => {
      const res = await api.get('/invoices?status=PAID');
      return res.data as Invoice[];
    },
    staleTime: 30_000,
  });
}

function useFinanceSummary() {
  return useQuery({
    queryKey: ['finance-summary'],
    queryFn: async () => {
      const res = await api.get('/finance/summary');
      return res.data as { paidThisMonth: number; totalInvoices: number; pendingPriceSet: boolean };
    },
    staleTime: 60_000,
  });
}

export function AccountantHome() {
  const { user } = useAuthStore();
  const { data: invoices = [], isLoading } = useInvoices();
  const { data: summary } = useFinanceSummary();

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  const tasks = [
    {
      label: 'Finance',
      sub: 'Invoices, expenses & import/export',
      icon: DollarSign,
      color: 'bg-brand-green',
      route: '/accountant/finance',
    },
    {
      label: 'Pricing',
      sub: 'Set today\'s egg prices per category',
      icon: Tag,
      color: 'bg-amber-500',
      route: '/accountant/pricing',
      alert: summary?.pendingPriceSet,
    },
    {
      label: 'Tally',
      sub: 'Verify and sign off on egg tallies',
      icon: FileText,
      color: 'bg-blue-500',
      route: '/accountant/tally',
    },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      {/* Greeting banner */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}! 👋</p>
        <p className="text-sm opacity-75 mt-0.5">Accountant Dashboard</p>
      </div>

      {/* Pricing alert */}
      {summary?.pendingPriceSet && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            Egg prices have not been set yet today — Sales cannot proceed until prices are set.
          </p>
        </div>
      )}

      {/* Task cards */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Today's Tasks
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {tasks.map(({ label, sub, icon: Icon, color, route, alert }) => (
            <a key={route} href={route}
              className="bg-white dark:bg-dark-card rounded-2xl p-4 md:p-5 shadow-sm
                border border-gray-100 dark:border-dark-border
                flex items-center gap-4 hover:shadow-md active:scale-[0.98]
                transition-all group relative no-underline"
            >
              {alert && (
                <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-amber-500 rounded-full" />
              )}
              <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">{label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* Finance summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Paid This Month</p>
          <p className="text-xl font-bold text-brand-green">
            {summary ? `KES ${(summary.paidThisMonth / 1000).toFixed(1)}K` : '—'}
          </p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Invoices</p>
          <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{summary?.totalInvoices ?? invoices.length}</p>
        </div>
      </div>

      {/* Recent invoices */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Recent Invoices
        </p>
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No invoices found</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {invoices.slice(0, 6).map(inv => {
              const config = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.PAID;
              const StatusIcon = config.icon;
              return (
                <div key={inv.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4 flex items-center gap-3">
                  <StatusIcon className={`w-5 h-5 flex-shrink-0 ${inv.status === 'PAID' ? 'text-green-500' : 'text-red-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm truncate">{inv.customer.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {inv.invoiceNumber} · {dayjs(inv.issuedAt).format('D MMM YYYY')}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-200">KES {Number(inv.totalAmountKes).toLocaleString()}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
