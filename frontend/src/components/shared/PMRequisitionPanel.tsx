// src/components/shared/PMRequisitionPanel.tsx
//
// Compact, read-only view of the Production Manager's item requisitions —
// shown to Store (and the Director) so they can see what the PM asked for
// even before it's been folded into an Issuance Plan. PM can raise a
// requisition against the current week (top-up on a week in progress — may
// land on an emergency plan if the week's weekly plan was already
// submitted) or the coming week (the routine one, due by Thursday).
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';
import { ClipboardList, Clock, CheckCircle } from 'lucide-react';

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

function RequisitionCard({ requisition, weekStart, label }: { requisition: any; weekStart: any; label: string }) {
  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-brand-green" />
          <div>
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200">PM Item Requisition — {label}</p>
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
                <span className="text-gray-600 dark:text-gray-300">{it.storeItem?.name}</span>
                <span className="text-gray-400">{Number(it.quantityNeeded).toFixed(2)} {it.storeItem?.unit}</span>
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

  const thisWeekReq = thisWeekReqs[0];
  const nextWeekReq = nextWeekReqs[0];

  const dow = dayjs().day();
  const pastPmDeadline = dow === 5 || dow === 6; // Fri / Sat — past the PM's own Thursday deadline for next week

  if (!thisWeekReq && !nextWeekReq) {
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
      {thisWeekReq && <RequisitionCard requisition={thisWeekReq} weekStart={thisWeek} label="This Week" />}
      {nextWeekReq && <RequisitionCard requisition={nextWeekReq} weekStart={nextWeek} label="Next Week" />}
    </div>
  );
}
