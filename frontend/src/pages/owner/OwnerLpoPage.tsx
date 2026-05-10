// src/pages/owner/OwnerLpoPage.tsx
// Director/Owner — view SUBMITTED LPOs and approve or reject them.
// Per Sequence Diagram: Accountant submits LPO → Director approveLPO() → saveApprovedLPO()
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';
import { CheckCircle, XCircle, Eye, X, FileText, ChevronDown, ChevronUp } from 'lucide-react';

function fmtKES(n?: number | string | null) {
  return `KES ${Number(n ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  SUBMITTED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  APPROVED:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  REJECTED:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  RECEIVED:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  CANCELLED: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
};

interface LPOItem {
  id: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  storeItem?: { name: string; sku: string; unit: string };
}

interface LPO {
  id: string;
  lpoNumber: string;
  lpoDate: string;
  supplierName: string;
  status: string;
  subtotal: number;
  vatAmount: number;
  grandTotal: number;
  notes?: string;
  purchaseRequest?: { requestRef: string };
  createdBy?: { fullName: string };
  items?: LPOItem[];
}

function LpoCard({
  lpo,
  onApprove,
  onReject,
}: {
  lpo: LPO;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const canAct = lpo.status === 'SUBMITTED';

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
      <div
        className="p-4 flex items-center gap-3 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <FileText className="w-5 h-5 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100 font-mono">{lpo.lpoNumber}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {lpo.supplierName} · {dayjs(lpo.lpoDate).format('D MMM YYYY')}
            {lpo.purchaseRequest ? ` · PR: ${lpo.purchaseRequest.requestRef}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{fmtKES(lpo.grandTotal)}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[lpo.status] ?? STATUS_BADGE.DRAFT}`}>
            {lpo.status}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-dark-border px-4 pb-4 pt-3 space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2">
              <p className="text-gray-400">Subtotal</p>
              <p className="font-semibold text-gray-700 dark:text-gray-300">{fmtKES(lpo.subtotal)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2">
              <p className="text-gray-400">VAT</p>
              <p className="font-semibold text-gray-700 dark:text-gray-300">{fmtKES(lpo.vatAmount)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2">
              <p className="text-gray-400">Grand Total</p>
              <p className="font-bold text-brand-green">{fmtKES(lpo.grandTotal)}</p>
            </div>
          </div>

          {/* Items */}
          {lpo.items && lpo.items.length > 0 && (
            <div className="text-xs">
              <p className="font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Items</p>
              <div className="space-y-1">
                {lpo.items.map(item => (
                  <div key={item.id} className="flex justify-between bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-1.5">
                    <span className="text-gray-700 dark:text-gray-300">
                      {item.storeItem?.name ?? item.description ?? 'Item'}
                    </span>
                    <span className="text-gray-500">
                      {item.quantity} × {fmtKES(item.unitPrice)} = <strong>{fmtKES(item.totalPrice)}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {lpo.notes && (
            <p className="text-xs text-gray-500 italic bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2">
              {lpo.notes}
            </p>
          )}

          {/* Actions */}
          {canAct && !showReject && (
            <div className="flex gap-2">
              <button
                onClick={() => onApprove(lpo.id)}
                className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-green-700 transition-colors"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Approve LPO
              </button>
              <button
                onClick={() => setShowReject(true)}
                className="flex items-center gap-1.5 border border-red-200 text-red-500 px-4 py-2 rounded-xl text-xs font-semibold"
              >
                <XCircle className="w-3.5 h-3.5" /> Reject
              </button>
            </div>
          )}

          {showReject && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">Reason for rejection *</p>
              <textarea
                rows={2}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="e.g. Budget exceeded, incorrect supplier..."
                className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { if (!rejectReason.trim()) return; onReject(lpo.id, rejectReason); setShowReject(false); }}
                  className="flex-1 bg-red-500 text-white py-2 rounded-xl text-xs font-semibold"
                >
                  Confirm Rejection
                </button>
                <button
                  onClick={() => { setShowReject(false); setRejectReason(''); }}
                  className="px-4 py-2 rounded-xl text-xs border border-gray-200 dark:border-dark-border text-gray-500"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OwnerLpoPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('SUBMITTED');

  const { data: lpos = [], isLoading } = useQuery<LPO[]>({
    queryKey: ['owner-lpos', statusFilter],
    queryFn: () =>
      api
        .get('/store/inventory/lpos', { params: statusFilter ? { status: statusFilter } : {} })
        .then(r => r.data),
    refetchInterval: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/store/inventory/lpos/${id}/approve`, {}).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-lpos'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/store/inventory/lpos/${id}/reject`, { rejectionReason: reason }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-lpos'] }),
  });

  const submittedCount = lpos.filter(l => l.status === 'SUBMITTED').length;

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" />
            LPO Approvals
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Review and approve Local Purchase Orders raised by the Accountant.
          </p>
        </div>
        {submittedCount > 0 && (
          <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold px-3 py-1.5 rounded-full">
            {submittedCount} awaiting approval
          </span>
        )}
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {['SUBMITTED', 'APPROVED', 'ALL'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s === 'ALL' ? '' : s)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              (statusFilter === s || (s === 'ALL' && statusFilter === ''))
                ? 'bg-brand-green text-white'
                : 'bg-white dark:bg-dark-card text-gray-500 border border-gray-200 dark:border-dark-border'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Error messages */}
      {(approveMutation.isError || rejectMutation.isError) && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {(approveMutation.error as any)?.response?.data?.message ??
            (rejectMutation.error as any)?.response?.data?.message ??
            'Action failed. Please try again.'}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-dark-card rounded-2xl animate-pulse" />)}</div>
      ) : lpos.length === 0 ? (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-10 text-center">
          <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
            {statusFilter === 'SUBMITTED' ? 'No LPOs awaiting approval' : 'No LPOs found'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lpos.map(lpo => (
            <LpoCard
              key={lpo.id}
              lpo={lpo}
              onApprove={id => approveMutation.mutate(id)}
              onReject={(id, reason) => rejectMutation.mutate({ id, reason })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
