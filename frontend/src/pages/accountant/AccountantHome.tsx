import { useState } from 'react';
import { AlertCircle, ChevronRight, Download, CheckCircle, Clock, XCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';

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
  PARTIAL: { label: 'Partial', color: 'bg-blue-100 text-blue-700',    icon: Clock },
  UNPAID:  { label: 'Unpaid',  color: 'bg-amber-100 text-amber-700',  icon: Clock },
  OVERDUE: { label: 'Overdue', color: 'bg-red-100 text-red-700',      icon: XCircle },
};

function useInvoices(status?: InvoiceStatus) {
  return useQuery({
    queryKey: ['invoices', status],
    queryFn: async () => {
      const params = status ? `?status=${status}` : '';
      const res = await api.get(`/invoices${params}`);
      return res.data as Invoice[];
    },
    staleTime: 30_000,
  });
}

function useArSummary() {
  return useQuery({
    queryKey: ['ar-summary'],
    queryFn: async () => {
      const res = await api.get('/finance/ar/summary');
      return res.data as { totalOutstanding: number; overdueCount: number; overdueAmount: number; paidThisMonth: number };
    },
    staleTime: 60_000,
  });
}

export function AccountantHome() {
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | undefined>(undefined);
  const { data: invoices = [], isLoading } = useInvoices(statusFilter);
  const { data: arSummary } = useArSummary();

  const overdueInvoices = invoices.filter(i => i.status === 'OVERDUE');

  return (
    <div className="p-4 space-y-5">
      {/* AR Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Total Outstanding</p>
          <p className="text-2xl font-bold text-gray-800">
            {arSummary ? `KES ${arSummary.totalOutstanding.toLocaleString()}` : '—'}
          </p>
        </div>
        <div className={`rounded-2xl p-4 shadow-sm border ${
          (arSummary?.overdueCount ?? 0) > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'
        }`}>
          <p className="text-xs text-gray-500 mb-1">Overdue</p>
          <p className={`text-2xl font-bold ${(arSummary?.overdueCount ?? 0) > 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {arSummary ? arSummary.overdueCount : '—'}
          </p>
          {arSummary?.overdueAmount ? (
            <p className="text-xs text-red-500 mt-0.5">KES {arSummary.overdueAmount.toLocaleString()}</p>
          ) : null}
        </div>
      </div>

      {/* Overdue alerts */}
      {overdueInvoices.length > 0 && (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="font-bold text-red-700">
              {overdueInvoices.length} {overdueInvoices.length === 1 ? 'Invoice' : 'Invoices'} Overdue — Follow Up Required
            </p>
          </div>
          {overdueInvoices.slice(0, 3).map(inv => (
            <div key={inv.id} className="bg-white rounded-xl p-3 mt-2 border border-red-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{inv.customer.name}</p>
                  <p className="text-xs text-gray-500">{inv.invoiceNumber} · Due {dayjs(inv.dueDate).format('D MMM')}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-red-600">KES {inv.balanceKes.toLocaleString()}</p>
                  <p className="text-xs text-red-400">{inv.daysOverdue}d overdue</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invoice Register */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-700">Invoice Register</p>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          {([undefined, 'OVERDUE', 'UNPAID', 'PARTIAL', 'PAID'] as const).map(s => (
            <button
              key={s ?? 'all'}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                statusFilter === s
                  ? 'bg-brand-gold text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s === undefined ? 'All' : STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center text-gray-400 py-8 text-sm">Loading invoices...</div>
        ) : invoices.length === 0 ? (
          <div className="text-center text-gray-400 py-8 text-sm">No invoices found</div>
        ) : (
          <div className="space-y-2">
            {invoices.map(inv => {
              const config = STATUS_CONFIG[inv.status];
              const StatusIcon = config.icon;
              return (
                <div
                  key={inv.id}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3"
                >
                  <StatusIcon className={`w-5 h-5 flex-shrink-0 ${
                    inv.status === 'PAID' ? 'text-green-500' :
                    inv.status === 'OVERDUE' ? 'text-red-500' :
                    inv.status === 'PARTIAL' ? 'text-blue-500' : 'text-amber-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-800 text-sm truncate">{inv.customer.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {inv.invoiceNumber} · {dayjs(inv.issuedAt).format('D MMM YYYY')}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-800">
                      KES {inv.balanceKes.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-400">of {inv.totalAmountKes.toLocaleString()}</p>
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
