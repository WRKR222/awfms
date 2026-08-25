// src/pages/store/IssuancePlanTab.tsx
// Store (create draft / submit any day) | Director (approve/reject) | Accountant (read-only)
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { useAuthStore } from '../../stores/auth.store';
import dayjs from '../../lib/dayjs';
import {
  ClipboardList, Plus, X, CheckCircle, XCircle, FileDown,
  ChevronDown, ChevronUp, AlertTriangle, Zap, Pencil, Calculator, Trash2,
} from 'lucide-react';
import { useIssuableStoreItems, FEED_CATEGORIES, MEDICATION_CATEGORIES } from '../../hooks/useIssuableStoreItems';
import { PMRequisitionPanel } from '../../components/shared/PMRequisitionPanel';

const DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
type DayKey = typeof DAY_KEYS[number];

// Per-ITEM status (what each line actually carries)
const ITEM_STATUS_BADGE: Record<string, string> = {
  PENDING_ACCOUNTANT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', // legacy
  PENDING_DIRECTOR:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  APPROVED:           'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  REJECTED:           'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const ITEM_STATUS_LABEL: Record<string, string> = {
  PENDING_ACCOUNTANT: 'Awaiting Director', // migrated items show same label
  PENDING_DIRECTOR:   'Awaiting Director',
  APPROVED:           'Approved',
  REJECTED:           'Rejected',
};

// Plan-level PHASE
const PHASE_BADGE: Record<string, string> = {
  DRAFT:              'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  PENDING_ACCOUNTANT: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', // legacy
  PENDING_DIRECTOR:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  DECIDED:            'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

const PHASE_LABEL: Record<string, string> = {
  DRAFT:              'Draft',
  PENDING_ACCOUNTANT: 'Awaiting Director', // legacy label
  PENDING_DIRECTOR:   'Awaiting Director',
  DECIDED:            'Decided',
};

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

function fmtKES(n: number) {
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

/** Returns the Monday of the NEXT week (the plan is built ahead for next week) */
function nextMonday() {
  const today = dayjs();
  const daysUntilMon = (8 - today.day()) % 7 || 7;
  // Use UTC date string directly so the backend can't misparse it as Sunday
  // due to timezone offset (Nairobi is UTC+3)
  return today.add(daysUntilMon, 'day');
}

/** Returns the Monday of the CURRENT week (for a catch-up plan when last
 *  Saturday's submission was missed). */
function thisMonday() {
  const today = dayjs();
  const daysSinceMon = (today.day() + 6) % 7; // Mon->0, Tue->1, ... Sun->6
  return today.subtract(daysSinceMon, 'day');
}

/** True if today (local) is Saturday. */
function isTodaySaturday() {
  return dayjs().day() === 6;
}


// ─── Per-item row: its own status badge + approve/reject/edit actions ────────

function ItemRow({
  plan,
  item,
  userRole,
  showDays,
  onRefresh,
}: {
  plan: any;
  item: any;
  userRole: string;
  showDays: boolean;
  onRefresh: () => void;
}) {
  const qc = useQueryClient();
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [approvedQty, setApprovedQty] = useState(String(Number(item.quantityPlanned)));

  const approveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/store/issuance-plans/${plan.id}/items/${item.id}/approve`, {
        quantityApproved: approvedQty ? Number(approvedQty) : undefined,
      }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['issuance-plans'] }); onRefresh(); },
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      api.patch(`/store/issuance-plans/${plan.id}/items/${item.id}/reject`, { rejectionReason: rejectReason }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['issuance-plans'] }); setShowReject(false); setRejectReason(''); onRefresh(); },
  });

  const canDirectorApprove = userRole === 'OWNER' && (item.status === 'PENDING_DIRECTOR' || item.status === 'PENDING_ACCOUNTANT');
  const canApprove = canDirectorApprove;
  const canReject = canDirectorApprove;
  // Director can approve on any day — no Saturday restriction

  const breakdown = item.dailyBreakdown as Record<string, number> | null;

  return (
    <div className="border border-gray-100 dark:border-dark-border rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
            {item.storeItem?.name ?? '—'}
          </span>
          {item.source === 'PM_FEED_PLAN' && (
            <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full flex-shrink-0">auto</span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${ITEM_STATUS_BADGE[item.status] ?? ITEM_STATUS_BADGE.PENDING_ACCOUNTANT}`}>
          {ITEM_STATUS_LABEL[item.status] ?? item.status}
        </span>
      </div>

      {showDays && breakdown && (
        <div className="grid grid-cols-7 gap-1">
          {DAY_KEYS.map(d => (
            <div key={d} className="text-center">
              <p className="text-[9px] text-gray-400">{d}</p>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300">{(breakdown[d] ?? 0).toFixed(1)}</p>
            </div>
          ))}
        </div>
      )}

      {item.source === 'PM_FEED_PLAN' && item.notes && (
        <div className="flex items-start gap-1.5 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg px-2.5 py-1.5">
          <Calculator className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] leading-snug text-blue-700 dark:text-blue-300">{item.notes}</p>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 flex-wrap gap-y-1">
        <span>Requested: <span className="font-semibold text-gray-700 dark:text-gray-300">{Number(item.quantityPlanned).toFixed(2)} {item.storeItem?.unit ?? ''}</span></span>
        <span>Approved: <span className="font-semibold text-gray-700 dark:text-gray-300">
          {item.quantityApproved != null ? Number(item.quantityApproved).toFixed(2) : '—'}
        </span></span>
        <span>Issued: <span className="font-semibold text-gray-700 dark:text-gray-300">{Number(item.quantityIssued).toFixed(2)}</span></span>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 flex-wrap gap-y-1">
        <span>Approved value: <span className="font-semibold text-brand-green">
          {fmtKES(Number(item.quantityApproved ?? item.quantityPlanned) * Number(item.unitPriceKes))}
        </span></span>
        <span>Issued value: <span className="font-semibold text-amber-600 dark:text-amber-400">
          {fmtKES(Number(item.quantityIssued) * Number(item.unitPriceKes))}
        </span></span>
      </div>
      {item.quantityApproved != null && Number(item.quantityApproved) !== Number(item.quantityPlanned) && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Approved quantity differs from what was requested.
        </p>
      )}

      {item.status === 'REJECTED' && item.rejectionReason && (
        <p className="text-xs text-red-500">
          Rejected by {item.rejectedBy?.fullName ?? '—'}: {item.rejectionReason}
        </p>
      )}
      {item.status === 'APPROVED' && item.directorApprovedBy && (
        <p className="text-xs text-green-600 dark:text-green-400">
          Approved by {item.directorApprovedBy.fullName} · {dayjs(item.directorApprovedAt).format('D MMM HH:mm')}
        </p>
      )}
      {item.accountantApprovedBy && item.status !== 'REJECTED' && (
        <p className="text-xs text-gray-400">
          Accountant: {item.accountantApprovedBy.fullName} · {dayjs(item.accountantApprovedAt).format('D MMM HH:mm')}
        </p>
      )}

      {canApprove && !showReject && (
        <div className="flex items-end gap-2">
          <div className="flex-1 max-w-[140px]">
            <label className="block text-[10px] font-semibold text-gray-400 mb-0.5">
              Approved qty {item.storeItem?.unit ? `(${item.storeItem.unit.toLowerCase()})` : ''}
            </label>
            <input
              type="number" step="any" min="0" max={Number(item.quantityPlanned)}
              value={approvedQty}
              onChange={e => setApprovedQty(e.target.value)}
              className="w-full border border-gray-200 dark:border-dark-border rounded-lg px-2 py-1 text-xs bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-green"
            />
          </div>
          <p className="text-[10px] text-gray-400 pb-1.5">
            of {Number(item.quantityPlanned).toFixed(2)} requested
          </p>
        </div>
      )}

      {(canApprove || canReject) && !showReject && (
        <div className="flex gap-2 pt-1">
          {canApprove && (
            <button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending || !approvedQty || Number(approvedQty) <= 0 || Number(approvedQty) > Number(item.quantityPlanned)}
              className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <CheckCircle className="w-3 h-3" /> {approveMutation.isPending ? 'Approving…' : 'Approve'}
            </button>
          )}
          {canReject && (
            <button
              onClick={() => setShowReject(true)}
              className="flex items-center gap-1 border border-red-200 text-red-500 px-3 py-1.5 rounded-lg text-xs font-semibold"
            >
              <XCircle className="w-3 h-3" /> Reject
            </button>
          )}
        </div>
      )}

      {showReject && (
        <div className="space-y-2 pt-1">
          <textarea
            rows={2}
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Reason for rejecting this item…"
            className={iCls + ' resize-none text-xs'}
          />
          <div className="flex gap-2">
            <button
              onClick={() => { if (!rejectReason.trim()) return; rejectMutation.mutate(); }}
              disabled={rejectMutation.isPending}
              className="flex-1 bg-red-500 text-white py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60"
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Reject'}
            </button>
            <button onClick={() => { setShowReject(false); setRejectReason(''); }}
              className="px-3 py-1.5 rounded-lg text-xs border border-gray-200 dark:border-dark-border text-gray-500">
              Back
            </button>
          </div>
        </div>
      )}

      {(approveMutation.isError || rejectMutation.isError) && (
        <p className="text-xs text-red-500">
          {(approveMutation.error as any)?.response?.data?.message ??
            (rejectMutation.error as any)?.response?.data?.message ??
            'Action failed.'}
        </p>
      )}
    </div>
  );
}

// ─── Plan Card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  userRole,
  onRefresh,
  onEdit,
}: {
  plan: any;
  userRole: string;
  onRefresh: () => void;
  onEdit: (plan: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const submitMutation = useMutation({
    mutationFn: () => api.patch(`/store/issuance-plans/${plan.id}/submit`).then(r => r.data),
    onSuccess: () => { onRefresh(); },
  });

  // Store-only, DRAFT-only — see IssuancePlanService.deletePlan for why
  // it's refused once submitted (approval state + possible stock-outs).
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/store/issuance-plans/${plan.id}`).then(r => r.data),
    onSuccess: () => { onRefresh(); },
  });

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const downloadPdf = async () => {
    setPdfLoading(true); setPdfError(null);
    try {
      const res = await api.get(`/store/issuance-plans/${plan.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `IssuancePlan-${plan.planRef}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch {
      setPdfError('Could not generate PDF. Please try again.');
    }
    setPdfLoading(false);
  };

  const items = plan.items ?? [];
  const approvedCount = items.filter((i: any) => i.status === 'APPROVED').length;
  const rejectedCount = items.filter((i: any) => i.status === 'REJECTED').length;
  const pendingCount = items.length - approvedCount - rejectedCount;

  const canSubmit = userRole === 'STORE' && plan.phase === 'DRAFT';
  const canDelete = userRole === 'STORE' && plan.phase === 'DRAFT';
  // Next-week weekly plans may only be submitted on Saturday; a plan for the
  // current week is treated as a catch-up (missed last Saturday) and can be
  // submitted any day. Emergency plans are never gated by day of week.
  const isNextWeekPlan = plan.type === 'WEEKLY' && dayjs(plan.weekStartDate).isSame(nextMonday(), 'day');
  const blockedBySaturdayRule = isNextWeekPlan && !isTodaySaturday();
  // Store edits while DRAFT. Director edits their queue (PENDING_DIRECTOR, or re-opens APPROVED/REJECTED).
  const ROLE_EDIT_ITEM_STATUSES: Record<string, string[]> = {
    STORE: ['PENDING_DIRECTOR'],
    OWNER: ['PENDING_DIRECTOR', 'APPROVED', 'REJECTED'],
  };
  const canEdit =
    (userRole === 'STORE' && plan.phase === 'DRAFT') ||
    (userRole === 'OWNER' &&
      items.some((i: any) => (ROLE_EDIT_ITEM_STATUSES['OWNER'] ?? []).includes(i.status)));

  const canPdf = approvedCount > 0 && ['STORE', 'ACCOUNTANT', 'OWNER'].includes(userRole);

  const totalKes = items.reduce((s: number, i: any) => s + Number(i.quantityPlanned) * Number(i.unitPriceKes), 0);
  const approvedItemsList = items.filter((i: any) => i.status === 'APPROVED');
  const approvedKes = approvedItemsList.reduce(
    (s: number, i: any) => s + Number(i.quantityApproved ?? i.quantityPlanned) * Number(i.unitPriceKes),
    0,
  );
  const issuedKes = approvedItemsList.reduce(
    (s: number, i: any) => s + Number(i.quantityIssued ?? 0) * Number(i.unitPriceKes),
    0,
  );

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
      <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          plan.type === 'EMERGENCY'
            ? 'bg-amber-100 dark:bg-amber-900/20'
            : 'bg-brand-green/10 dark:bg-brand-green/20'
        }`}>
          {plan.type === 'EMERGENCY'
            ? <Zap className="w-5 h-5 text-amber-500" />
            : <ClipboardList className="w-5 h-5 text-brand-green" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100 font-mono">{plan.planRef}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {dayjs(plan.weekStartDate).format('D MMM')} – {dayjs(plan.weekEndDate).format('D MMM YYYY')}
            {plan.type === 'EMERGENCY' && ' · Emergency'}
            {items.length > 0 && ` · ${approvedCount} approved, ${rejectedCount} rejected, ${pendingCount} pending`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${PHASE_BADGE[plan.phase] ?? PHASE_BADGE.DRAFT}`}>
            {PHASE_LABEL[plan.phase] ?? plan.phase}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-dark-border px-4 pb-4 pt-3 space-y-3">
          {/* Plan meta */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <p>Created by: <span className="font-medium text-gray-700 dark:text-gray-300">{plan.createdBy?.fullName ?? '—'}</span></p>
          </div>

          {plan.notes && (
            <p className="text-xs text-gray-500 italic bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2">
              {plan.notes}
            </p>
          )}

          {plan.type === 'EMERGENCY' && plan.emergencyReason && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2">
              <span className="font-semibold">Reason:</span> {plan.emergencyReason}
            </p>
          )}

          {/* Per-item rows — each carries its own status + actions */}
          {items.length > 0 ? (
            <div className="space-y-2">
              {items.map((item: any) => (
                <ItemRow
                  key={item.id}
                  plan={plan}
                  item={item}
                  userRole={userRole}
                  showDays={plan.type === 'WEEKLY'}
                  onRefresh={onRefresh}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-2">No items on this plan yet.</p>
          )}

          {items.length > 0 && (
            <div className="flex flex-col gap-1 text-xs font-bold pt-1 border-t border-gray-100 dark:border-dark-border">
              <div className="flex items-center justify-between flex-wrap gap-y-1">
                <span className="text-gray-500">Total requested: {fmtKES(totalKes)}</span>
                <span className="text-brand-green">Total approved value: {fmtKES(approvedKes)}</span>
              </div>
              <div className="flex items-center justify-end">
                <span className="text-amber-600 dark:text-amber-400">Total issued value: {fmtKES(issuedKes)}</span>
              </div>
            </div>
          )}

          {/* Plan-level actions: submit (Store), edit, PDF */}
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <button
                onClick={() => onEdit(plan)}
                className="flex items-center gap-1.5 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}

            {canSubmit && (
              <button
                onClick={() => submitMutation.mutate()}
                disabled={
                  submitMutation.isPending ||
                  (plan.type === 'EMERGENCY' && !plan.emergencyReason?.trim()) ||
                  blockedBySaturdayRule
                }
                title={
                  blockedBySaturdayRule
                    ? "This is a next-week plan — it can only be submitted on Saturday. If you missed last Saturday, edit it (or create a new plan) for the current week instead."
                    : plan.type === 'EMERGENCY' && !plan.emergencyReason?.trim()
                    ? 'A reason is required before this emergency plan can be submitted'
                    : ''
                }
                className="flex items-center gap-1.5 bg-brand-green text-white px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {submitMutation.isPending ? 'Submitting…' : 'Submit for Approval'}
              </button>
            )}
            {canSubmit && blockedBySaturdayRule && (
              <p className="w-full text-xs text-amber-600 dark:text-amber-400">
                Next week's plan — submission opens this Saturday. Missed last Saturday? Edit this plan for the current week instead.
              </p>
            )}

            {canPdf && (
              <button
                onClick={downloadPdf}
                disabled={pdfLoading}
                className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                <FileDown className="w-3.5 h-3.5" /> {pdfLoading ? 'Generating…' : 'Download PDF'}
              </button>
            )}

            {canDelete && (
              <button
                onClick={() => {
                  if (window.confirm(`Delete draft plan ${plan.planRef}? This cannot be undone.`)) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1.5 border border-red-200 dark:border-red-900/40 text-red-500 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" /> {deleteMutation.isPending ? 'Deleting…' : 'Delete Draft'}
              </button>
            )}
          </div>

          {submitMutation.isError && (
            <p className="text-xs text-red-500">
              {(submitMutation.error as any)?.response?.data?.message ?? 'Failed to submit plan.'}
            </p>
          )}
          {deleteMutation.isError && (
            <p className="text-xs text-red-500">
              {(deleteMutation.error as any)?.response?.data?.message ?? 'Failed to delete plan.'}
            </p>
          )}
          {pdfError && <p className="text-xs text-red-500">{pdfError}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Create Plan Form ─────────────────────────────────────────────────────────

function CreatePlanForm({
  type,
  editingPlan,
  onClose,
  onCreated,
}: {
  type: 'WEEKLY' | 'EMERGENCY';
  editingPlan?: any;
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const isEditing = !!editingPlan;
  // For a new plan, Store chooses whether this targets the CURRENT farm week
  // (a catch-up plan, e.g. she missed last Saturday's submission) or the
  // NEXT one (the normal advance plan, submittable only this coming
  // Saturday). Editing an existing plan keeps its original week.
  const [weekChoice, setWeekChoice] = useState<'CURRENT' | 'NEXT'>('NEXT');
  const mon = editingPlan ? dayjs(editingPlan.weekStartDate) : (weekChoice === 'CURRENT' ? thisMonday() : nextMonday());
  const [notes, setNotes] = useState(editingPlan?.notes ?? '');
  const [emergencyReason, setEmergencyReason] = useState(editingPlan?.emergencyReason ?? '');
  const [items, setItems] = useState<
    { id?: string; source?: string; status?: string; notes?: string; quantityIssued?: number; storeItemId: string; unitPriceKes: number; dailyBreakdown: Record<DayKey, number>; emergencyQty: number }[]
  >(() => {
    if (!editingPlan?.items) return [];
    return editingPlan.items.map((it: any) => {
      const breakdown = (it.dailyBreakdown as Record<string, number> | null) ?? {};
      return {
        id: it.id,
        source: it.source,
        status: it.status,
        notes: it.notes ?? undefined,
        quantityIssued: Number(it.quantityIssued ?? 0),
        storeItemId: it.storeItemId,
        unitPriceKes: Number(it.unitPriceKes),
        dailyBreakdown: {
          MON: breakdown.MON ?? 0, TUE: breakdown.TUE ?? 0, WED: breakdown.WED ?? 0,
          THU: breakdown.THU ?? 0, FRI: breakdown.FRI ?? 0, SAT: breakdown.SAT ?? 0, SUN: breakdown.SUN ?? 0,
        },
        emergencyQty: Number(it.quantityPlanned),
      };
    });
  });

  const {
    data: storeItems = [],
    isLoading: storeItemsLoading,
    isError: storeItemsError,
  } = useQuery<any[]>({
    queryKey: ['store-items'],
    queryFn: () =>
      api.get('/store/inventory/items', { params: { isActive: 'true' } }).then(r => {
        if (Array.isArray(r.data) && r.data.length === 0) {
          return api.get('/store/inventory/items').then(fb => fb.data);
        }
        return r.data;
      }),
    staleTime: 60_000,
  });

  // Current-week residual (issued - dispensed) for feed & medication items,
  // so Store can see leftover stock still on the floor before issuing more
  // of the same item and over-supplying.
  const { data: feedResidual = [] }       = useIssuableStoreItems(FEED_CATEGORIES);
  const { data: medicationResidual = [] } = useIssuableStoreItems(MEDICATION_CATEGORIES);
  const residualByItemId = new Map(
    [...feedResidual, ...medicationResidual].map(r => [r.id, r]),
  );

  const addItem = () => {
    setItems(prev => [
      ...prev,
      {
        storeItemId: '',
        unitPriceKes: 0,
        dailyBreakdown: { MON: 0, TUE: 0, WED: 0, THU: 0, FRI: 0, SAT: 0, SUN: 0 },
        emergencyQty: 0,
      },
    ]);
  };

  const updateItem = (idx: number, field: string, value: any) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };

  const updateDay = (idx: number, day: DayKey, val: string) => {
    setItems(prev =>
      prev.map((it, i) =>
        i === idx
          ? { ...it, dailyBreakdown: { ...it.dailyBreakdown, [day]: parseFloat(val) || 0 } }
          : it,
      ),
    );
  };

  const selectedItem = (idx: number) =>
    storeItems.find((s: any) => s.id === items[idx]?.storeItemId);

  const createMutation = useMutation({
    mutationFn: () => {
      const builtItems = items.map(it => {
        const si = storeItems.find((s: any) => s.id === it.storeItemId) as any;
        const base = { id: it.id, source: it.source };
        if (type === 'WEEKLY') {
          const total = Object.values(it.dailyBreakdown).reduce((s, v) => s + v, 0);
          return {
            ...base,
            storeItemId: it.storeItemId,
            quantityPlanned: total,
            unitPriceKes: it.unitPriceKes || Number(si?.unitCostKes ?? 0),
            dailyBreakdown: it.dailyBreakdown,
          };
        } else {
          return {
            ...base,
            storeItemId: it.storeItemId,
            quantityPlanned: it.emergencyQty,
            unitPriceKes: it.unitPriceKes || Number(si?.unitCostKes ?? 0),
          };
        }
      });

      if (isEditing) {
        return api
          .patch(`/store/issuance-plans/${editingPlan.id}`, {
            notes: notes || undefined,
            emergencyReason: type === 'EMERGENCY' ? emergencyReason : undefined,
            items: builtItems,
          })
          .then(r => r.data);
      }
      return api
        .post('/store/issuance-plans', {
          type,
          weekStartDate: mon.utc(true).format('YYYY-MM-DD'),
          notes: notes || undefined,
          emergencyReason: type === 'EMERGENCY' ? emergencyReason : undefined,
          items: builtItems,
        })
        .then(r => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issuance-plans'] });
      onCreated();
      onClose();
    },
  });

  const totalKes = items.reduce((s, it) => {
    const qty =
      type === 'WEEKLY'
        ? Object.values(it.dailyBreakdown).reduce((a, b) => a + b, 0)
        : it.emergencyQty;
    return s + qty * (it.unitPriceKes || 0);
  }, 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-3xl rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[94vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${type === 'EMERGENCY' ? 'bg-amber-100' : 'bg-brand-green/10'}`}>
              {type === 'EMERGENCY' ? <Zap className="w-4 h-4 text-amber-500" /> : <ClipboardList className="w-4 h-4 text-brand-green" />}
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">
                {isEditing
                  ? `Edit ${type === 'EMERGENCY' ? 'Emergency' : 'Weekly'} Plan — ${editingPlan.planRef}`
                  : type === 'EMERGENCY' ? 'Emergency Issuance Plan' : 'New Weekly Issuance Plan'}
              </p>
              <p className="text-xs text-gray-400">
                Week of {mon.format('D MMM')} – {mon.add(6, 'day').format('D MMM YYYY')}
                {!isEditing && weekChoice === 'CURRENT' && ' · Current week (catch-up)'}
                {!isEditing && weekChoice === 'NEXT' && ' · Next week'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Target week — Store picks current (catch-up) or next week */}
          {!isEditing && (
            <div>
              <label className={lCls}>Target Week</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWeekChoice('CURRENT')}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold border text-left transition-colors ${
                    weekChoice === 'CURRENT'
                      ? 'bg-brand-green/10 border-brand-green text-brand-green'
                      : 'border-gray-200 dark:border-dark-border text-gray-500 dark:text-gray-400'
                  }`}
                >
                  Current Week
                  <span className="block font-normal text-[11px] mt-0.5">
                    {thisMonday().format('D MMM')} – {thisMonday().add(6, 'day').format('D MMM')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setWeekChoice('NEXT')}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold border text-left transition-colors ${
                    weekChoice === 'NEXT'
                      ? 'bg-brand-green/10 border-brand-green text-brand-green'
                      : 'border-gray-200 dark:border-dark-border text-gray-500 dark:text-gray-400'
                  }`}
                >
                  Next Week
                  <span className="block font-normal text-[11px] mt-0.5">
                    {nextMonday().format('D MMM')} – {nextMonday().add(6, 'day').format('D MMM')}
                  </span>
                </button>
              </div>
              {type === 'WEEKLY' && weekChoice === 'CURRENT' && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  Use this if you weren't able to submit last Saturday — a current-week plan can be submitted today.
                </p>
              )}
              {type === 'WEEKLY' && weekChoice === 'NEXT' && (
                <p className="text-xs text-gray-400 mt-1.5">
                  {isTodaySaturday()
                    ? 'It\'s Saturday — you can submit this plan today.'
                    : 'This plan can only be submitted this coming Saturday.'}
                </p>
              )}
            </div>
          )}

          {/* Re-approval notice when editing items that are already decided */}
          {isEditing && editingPlan.items?.some((i: any) => ['APPROVED', 'REJECTED'].includes(i.status)) && (
            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Some items are already approved or rejected. Editing those will reopen them for Director re-approval — items you don't touch keep their current outcome.
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={lCls}>Notes (optional)</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={iCls + ' resize-none'} placeholder="Any notes for this plan…" />
          </div>

          {/* Mandatory reason for emergency plans */}
          {type === 'EMERGENCY' && (
            <div>
              <label className={lCls}>Reason for Emergency Plan <span className="text-red-500">*</span></label>
              <textarea
                rows={3}
                value={emergencyReason}
                onChange={e => setEmergencyReason(e.target.value)}
                className={iCls + ' resize-none'}
                placeholder="Explain why this emergency issuance is needed (required before saving)…"
              />
              {!emergencyReason.trim() && (
                <p className="text-xs text-red-500 mt-1">A reason is required for emergency issuance plans.</p>
              )}
            </div>
          )}

          {/* Items */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-700 dark:text-gray-200">Items</p>
              <button onClick={addItem} className="flex items-center gap-1.5 text-xs text-brand-green font-semibold hover:underline">
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>

            {items.length === 0 && (
              <div className="text-center py-6 text-gray-400 dark:text-gray-500 text-sm border border-dashed border-gray-200 dark:border-dark-border rounded-xl">
                No items yet. Click "+ Add Item" to start.
              </div>
            )}

            {items.map((it, idx) => {
              const si = selectedItem(idx) as any;
              return (
                <div key={idx} className="bg-gray-50 dark:bg-dark-bg rounded-xl p-4 space-y-3 border border-gray-100 dark:border-dark-border">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Item {idx + 1}
                      {it.source === 'PM_FEED_PLAN' && (
                        <span className="ml-1.5 text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full normal-case">auto · PM feed plan</span>
                      )}
                      {it.status && (
                        <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full normal-case ${ITEM_STATUS_BADGE[it.status] ?? ''}`}>
                          {ITEM_STATUS_LABEL[it.status] ?? it.status}
                        </span>
                      )}
                    </p>
                    {(it.quantityIssued ?? 0) > 0 ? (
                      <span title="Stock has already been issued against this line — it can't be removed." className="text-gray-300 dark:text-gray-600 cursor-not-allowed">
                        <X className="w-4 h-4" />
                      </span>
                    ) : (
                      <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lCls}>Store Item *</label>
                      <select
                        value={it.storeItemId}
                        disabled={storeItemsLoading}
                        onChange={e => {
                          const found = storeItems.find((s: any) => s.id === e.target.value) as any;
                          updateItem(idx, 'storeItemId', e.target.value);
                          if (found) updateItem(idx, 'unitPriceKes', Number(found.unitCostKes));
                        }}
                        className={iCls}
                      >
                        {storeItemsLoading ? (
                          <option value="">Loading items…</option>
                        ) : storeItemsError ? (
                          <option value="">Failed to load items</option>
                        ) : storeItems.length === 0 ? (
                          <option value="">No items in catalogue</option>
                        ) : (
                          <>
                            <option value="">Select item…</option>
                            {storeItems.map((s: any) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.unit}) — {Number(s.currentStock).toFixed(2)} in stock
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                      {storeItemsError && (
                        <p className="text-xs text-red-500 mt-1">Could not load store items. Check your connection.</p>
                      )}
                      {(() => {
                        const residual = it.storeItemId ? residualByItemId.get(it.storeItemId) : undefined;
                        if (!residual || residual.residual <= 0) return null;
                        return (
                          <p className="text-xs mt-1 text-amber-600 dark:text-amber-400 flex items-start gap-1">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            {residual.residual.toFixed(2)} {residual.unit.toLowerCase()} still unused from this week's issuance — consider issuing less to avoid wastage.
                          </p>
                        );
                      })()}
                    </div>
                    <div>
                      <label className={lCls}>Unit Price (KES)</label>
                      <input
                        type="number" step="any" min="0"
                        value={it.unitPriceKes}
                        onChange={e => updateItem(idx, 'unitPriceKes', parseFloat(e.target.value) || 0)}
                        className={iCls}
                        placeholder={si ? String(Number(si.unitCostKes).toFixed(2)) : '0.00'}
                      />
                    </div>
                  </div>

                  {/* Weekly: per-day inputs */}
                  {type === 'WEEKLY' && (
                    <div>
                      {it.source === 'PM_FEED_PLAN' && it.notes && (
                        <div className="flex items-start gap-1.5 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg px-2.5 py-1.5 mb-2">
                          <Calculator className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                          <p className="text-[11px] leading-snug text-blue-700 dark:text-blue-300">{it.notes}</p>
                        </div>
                      )}
                      <label className={lCls}>Daily Quantity ({si?.unit ?? 'units'})</label>
                      <div className="grid grid-cols-7 gap-1">
                        {DAY_KEYS.map(d => (
                          <div key={d} className="text-center">
                            <p className="text-[10px] text-gray-400 mb-0.5">{d}</p>
                            <input
                              type="number" step="any" min="0"
                              value={it.dailyBreakdown[d] || ''}
                              onChange={e => updateDay(idx, d, e.target.value)}
                              className="w-full border border-gray-200 dark:border-dark-border rounded-lg px-1 py-1.5 text-xs text-center bg-white dark:bg-dark-card text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-green"
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mt-1 text-right">
                        Week total: {Object.values(it.dailyBreakdown).reduce((a, b) => a + b, 0).toFixed(2)} {si?.unit ?? ''}
                      </p>
                    </div>
                  )}

                  {/* Emergency: single total qty */}
                  {type === 'EMERGENCY' && (
                    <div>
                      <label className={lCls}>Total Quantity ({si?.unit ?? 'units'})</label>
                      <input
                        type="number" step="any" min="0"
                        value={it.emergencyQty || ''}
                        onChange={e => updateItem(idx, 'emergencyQty', parseFloat(e.target.value) || 0)}
                        className={iCls}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Total */}
          {items.length > 0 && (
            <div className="text-right text-sm font-bold text-brand-green">
              Estimated Total: {fmtKES(totalKes)}
            </div>
          )}

          {/* Submit error */}
          {createMutation.isError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {(createMutation.error as any)?.response?.data?.message ?? 'Failed to create plan. Please try again.'}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold text-sm">
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={
                createMutation.isPending ||
                items.length === 0 ||
                items.some(i => !i.storeItemId) ||
                (type === 'EMERGENCY' && !emergencyReason.trim())
              }
              className="flex-1 bg-brand-green text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60"
            >
              {createMutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Save Plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function IssuancePlanTab() {
  const { user } = useAuthStore();
  const userRole = (user as any)?.role ?? '';
  const [showCreate, setShowCreate] = useState<'WEEKLY' | 'EMERGENCY' | null>(null);
  const [editingPlan, setEditingPlan] = useState<any | null>(null);
  const [phaseFilter, setPhaseFilter] = useState('');

  const { data: plans = [], refetch } = useQuery<any[]>({
    queryKey: ['issuance-plans', phaseFilter],
    queryFn: () =>
      api
        .get('/store/issuance-plans', { params: phaseFilter ? { phase: phaseFilter } : {} })
        .then(r => r.data),
    refetchInterval: 30_000,
  });

  const canCreate = ['STORE'].includes(userRole);
  // Count individual ITEMS awaiting Director action across all plans
  const pendingCount = plans.reduce((sum, p) => {
    const items = p.items ?? [];
    if (userRole === 'OWNER') return sum + items.filter((i: any) => ['PENDING_DIRECTOR', 'PENDING_ACCOUNTANT'].includes(i.status)).length;
    return sum;
  }, 0);

  const phaseOptions = [
    { label: 'All', value: '' },
    // Director never sees DRAFT plans (backend excludes them entirely for
    // OWNER — see IssuancePlanService.listPlans), so this filter option
    // would only ever return an empty list for them; hide it rather than
    // offer a dead end.
    ...(userRole === 'OWNER' ? [] : [{ label: 'Draft', value: 'DRAFT' }]),
    { label: 'Awaiting Director', value: 'PENDING_DIRECTOR' },
    { label: 'Decided', value: 'DECIDED' },
  ];

  return (
    <div className="space-y-4">
      {/* PM's weekly item list — read-only, Store-only. The Director no
          longer sees PM requisitions at all (backend also blocks the
          endpoints directly for OWNER — see PMRequisitionController). */}
      {userRole === 'STORE' && <PMRequisitionPanel />}

      {/* Actions row */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {pendingCount > 0 && (
          <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold px-3 py-1.5 rounded-full">
            {pendingCount} item{pendingCount > 1 ? 's' : ''} awaiting review
          </span>
        )}
        {canCreate && (
          <>
            <button
              onClick={() => setShowCreate('WEEKLY')}
              className="flex items-center gap-1.5 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-mid transition-colors"
              title="Create weekly issuance plan"
            >
              <Plus className="w-4 h-4" /> Weekly Plan
            </button>
            <button
              onClick={() => setShowCreate('EMERGENCY')}
              className="flex items-center gap-1.5 bg-amber-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-amber-600 transition-colors"
            >
              <Zap className="w-4 h-4" /> Emergency
            </button>
          </>
        )}
      </div>

      {/* Phase filter */}
      <div className="flex flex-wrap gap-1.5">
        {phaseOptions.map(opt => (
          <button
            key={opt.value}
            onClick={() => setPhaseFilter(opt.value)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              phaseFilter === opt.value
                ? 'bg-brand-green text-white'
                : 'bg-white dark:bg-dark-card text-gray-500 border border-gray-200 dark:border-dark-border'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Plans list */}
      {plans.length === 0 ? (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-12 text-center">
          <ClipboardList className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
            No issuance plans found
          </p>
          {canCreate && (
            <p className="text-xs text-gray-400 mt-1">Draft anytime for Director approval — current-week plans can be submitted any day, next-week plans on Saturday.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map(plan => (
            <PlanCard key={plan.id} plan={plan} userRole={userRole} onRefresh={refetch} onEdit={setEditingPlan} />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreatePlanForm
          type={showCreate}
          onClose={() => setShowCreate(null)}
          onCreated={() => refetch()}
        />
      )}

      {/* Edit modal */}
      {editingPlan && (
        <CreatePlanForm
          type={editingPlan.type}
          editingPlan={editingPlan}
          onClose={() => setEditingPlan(null)}
          onCreated={() => refetch()}
        />
      )}
    </div>
  );
}
