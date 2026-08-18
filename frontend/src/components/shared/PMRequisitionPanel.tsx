// src/components/shared/PMRequisitionPanel.tsx
//
// Compact, read-only view of the Production Manager's item requisitions —
// shown to Store (and the Director) so they can see what the PM asked for
// even before it's been folded into an Issuance Plan. PM can raise a
// requisition against the current week (top-up on a week in progress — may
// land on an emergency plan if the week's weekly plan was already
// submitted) or the coming week (the routine one, due by Thursday).
//
// A week is not limited to a single requisition — the PM can send several
// separate lists across the week, so every one for the week is shown here,
// not just the first.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';
import { ClipboardList, Clock, CheckCircle, X } from 'lucide-react';

function nextMondayDate() {
  const today = dayjs();
  const daysUntilMon = (8 - today.day()) % 7 || 7;
  return today.add(daysUntilMon, 'day').startOf('day');
}

function thisMondayDate() {
  const today = dayjs();
  const daysSinceMon = (today.day() + 6) % 7;
  return today.subtract(daysSinceMon, 'day').startOf('day');
}

function RequisitionCard({
  requisition, weekStart, label, onDeleteItem, deletingItemId,
}: {
  requisition: any; weekStart: any; label: string;
  onDeleteItem: (requisitionId: string, itemId: string) => void;
  deletingItemId: string | null;
}) {
  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-brand-green" />
          <div>
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
              PM Item Requisition — {label} <span className="text-gray-400 font-normal">({requisition.requisitionRef})</span>
            </p>
            <p className="text-[11px] text-gray-400">{weekStart.format('D MMM')} – {weekStart.add(6, 'day').format('D MMM YYYY')}</p>
          </div>
        </div>
        <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold flex-shrink-0 ${
          requisition.status === 'SUBMITTED'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
        }`}>
          {requisition.status === 'SUBMITTED' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
          {requisition.status === 'SUBMITTED' ? 'Sent' : 'Still drafting'}
        </span>
      </div>

      {requisition.status === 'DRAFT' ? (
        <p className="text-xs text-gray-400">
          {requisition.requisitionRef} is still being drafted by {requisition.createdBy?.fullName ?? 'the PM'} — not yet visible on any issuance plan.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-2">
            {requisition.requisitionRef} · sent by {requisition.createdBy?.fullName ?? 'the PM'} on {dayjs(requisition.submittedAt).format('D MMM, h:mm A')}.
            Already folded into a draft issuance plan — if this week's weekly plan was already submitted, look for it on an emergency plan instead.
          </p>
          <div className="space-y-1.5">
            {requisition.items.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                  {it.storeItem?.name ?? it.customItemName}
                  {!it.storeItemId && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      Not in store
                    </span>
                  )}
                  {it.dailyBreakdown && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      By day
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">{Number(it.quantityNeeded).toFixed(2)} {it.storeItem?.unit ?? it.customItemUnit ?? ''}</span>
                  <button
                    onClick={() => onDeleteItem(requisition.id, it.id)}
                    disabled={deletingItemId === it.id}
                    className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 disabled:opacity-50 flex-shrink-0"
                    title="Delete this item — also removes it from the issuance plan draft it was folded into"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {requisition.notes && (
            <p className="text-[11px] text-gray-400 mt-2 italic">"{requisition.notes}"</p>
          )}
        </>
      )}
    </div>
  );
}

export function PMRequisitionPanel() {
  const qc = useQueryClient();
  const thisWeek = thisMondayDate();
  const nextWeek = nextMondayDate();
  const thisWeekStr = thisWeek.format('YYYY-MM-DD');
  const nextWeekStr = nextWeek.format('YYYY-MM-DD');

  const { data: thisWeekReqs = [] } = useQuery<any[]>({
    queryKey: ['pm-requisitions', thisWeekStr],
    queryFn: () => api.get('/store/pm-requisitions', { params: { weekStartDate: thisWeekStr } }).then(r => r.data),
  });
  const { data: nextWeekReqs = [] } = useQuery<any[]>({
    queryKey: ['pm-requisitions', nextWeekStr],
    queryFn: () => api.get('/store/pm-requisitions', { params: { weekStartDate: nextWeekStr } }).then(r => r.data),
  });

  // Lets Store/Director remove a line straight from this panel too — not
  // just the PM who originally sent it. Backed by
  // PM_REQUISITION_ITEM_DELETE (granted to MANAGER, STORE, and OWNER), and
  // cascades to whichever issuance plan draft the line was folded into,
  // same as the PM's own delete on RequisitionsPage.
  const deleteItem = useMutation({
    mutationFn: ({ requisitionId, itemId }: { requisitionId: string; itemId: string }) =>
      api.delete(`/store/pm-requisitions/${requisitionId}/items/${itemId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pm-requisitions'] });
    },
  });
  const handleDeleteItem = (requisitionId: string, itemId: string) =>
    deleteItem.mutate({ requisitionId, itemId });
  const deletingItemId = deleteItem.isPending ? deleteItem.variables?.itemId ?? null : null;

  // A week isn't limited to one requisition — show every one Store/Director
  // can see for each week, not just the first.
  const dow = dayjs().day();
  const pastPmDeadline = dow === 5 || dow === 6; // Fri / Sat — past the PM's own Thursday deadline for next week

  if (thisWeekReqs.length === 0 && nextWeekReqs.length === 0) {
    // Avoid clutter once we're well past the routine Thursday deadline and
    // there's still nothing for either week — a gentle note is only useful
    // context earlier in the week.
    if (!pastPmDeadline) return null;
    return (
      <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
        <Clock className="w-4 h-4 flex-shrink-0" />
        The Production Manager hasn't sent a weekly item list for {nextWeek.format('D MMM')} – {nextWeek.add(6, 'day').format('D MMM YYYY')} yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {thisWeekReqs.map((req: any) => (
        <RequisitionCard key={req.id} requisition={req} weekStart={thisWeek} label="This Week" onDeleteItem={handleDeleteItem} deletingItemId={deletingItemId} />
      ))}
      {nextWeekReqs.map((req: any) => (
        <RequisitionCard key={req.id} requisition={req} weekStart={nextWeek} label="Next Week" onDeleteItem={handleDeleteItem} deletingItemId={deletingItemId} />
      ))}
    </div>
  );
}
