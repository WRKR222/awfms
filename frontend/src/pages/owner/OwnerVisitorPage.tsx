// src/pages/owner/OwnerVisitorPage.tsx
// Director approves / rejects visitor advance notices.
// OO Design: Director.approveVisitors() | Sequence: approveVisitor()
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { useAuthStore } from '../../stores/auth.store';
import { CheckCircle, XCircle, Clock, User, CalendarDays, Info } from 'lucide-react';
import dayjs from 'dayjs';

interface AdvanceNotice {
  id: string;
  visitorName: string;
  organisation?: string;
  purpose: string;
  expectedDate: string;  // FIX: was expectedArrival — backend returns expectedDate
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  directorNote?: string;
  submittedBy?: { username: string };
}

const card = 'bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4';
const STATUS_STYLE: Record<string, string> = {
  PENDING:  'bg-amber-50  text-amber-700  dark:bg-amber-900/20  dark:text-amber-400',
  APPROVED: 'bg-green-50  text-green-700  dark:bg-green-900/20  dark:text-green-400',
  REJECTED: 'bg-red-50    text-red-700    dark:bg-red-900/20    dark:text-red-400',
};

export default function OwnerVisitorPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();

  const { data: notices = [], isLoading } = useQuery<AdvanceNotice[]>({
    queryKey: ['owner-advance-notices'],
    queryFn: () =>
      api.get('/health/visitors/advance?days=30').then(r => r.data).catch(() => []),
    refetchInterval: 60_000,
  });

  // FIX: Director approves → backend triggers sendApprovedVisitorList() to security
  // (Visitor Approval Sequence Diagram: approveVisitor() → updateApprovalStatus() → sendApprovedVisitorList())
  const decide = useMutation({
    mutationFn: ({ id, status, directorNote }: { id: string; status: 'APPROVED' | 'REJECTED'; directorNote?: string }) =>
      api.patch(`/health/visitors/advance/${id}/status`, { status, directorNote }).then(r => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['owner-advance-notices'] });
      // The health module notifies security roles when status = APPROVED
      // (sendApprovedVisitorList per sequence diagram)
    },
  });

  const pending  = notices.filter(n => n.status === 'PENDING');
  const resolved = notices.filter(n => n.status !== 'PENDING');

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Visitor Approvals</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Review and approve advance visitor notices from the Production Manager
        </p>
      </div>

      {/* Pending notices */}
      <section>
        <h2 className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4" /> Pending Approval ({pending.length})
        </h2>
        {isLoading && <p className="text-gray-400 text-sm">Loading...</p>}
        {!isLoading && pending.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">No pending visitor notices.</p>
        )}
        {pending.map(notice => (
          <NoticeCard
            key={notice.id}
            notice={notice}
            onDecide={(status, note) => decide.mutate({ id: notice.id, status, directorNote: note })}
            isPending
          />
        ))}
      </section>

      {/* Resolved */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3">
          Recent Decisions (last 30 days)
        </h2>
        {resolved.slice(0, 10).map(notice => (
          <NoticeCard key={notice.id} notice={notice} />
        ))}
      </section>
    </div>
  );
}

function NoticeCard({
  notice, onDecide, isPending,
}: {
  notice: AdvanceNotice;
  onDecide?: (status: 'APPROVED' | 'REJECTED', note?: string) => void;
  isPending?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4 mb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-gray-400" />
            <span className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{notice.visitorName}</span>
            {notice.organisation && (
              <span className="text-xs text-gray-500">— {notice.organisation}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span className="font-medium text-gray-700 dark:text-gray-300">Purpose:</span> {notice.purpose}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            Expected: {dayjs(notice.expectedDate).format('D MMM YYYY, HH:mm')}
          </p>
          {notice.submittedBy && (
            <p className="text-xs text-gray-400 mt-1">Submitted by: {notice.submittedBy.username}</p>
          )}
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLE[notice.status]}`}>
          {notice.status}
        </span>
      </div>

      {isPending && onDecide && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-dark-border flex gap-2 justify-end">
          <button
            onClick={() => onDecide('REJECTED')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" /> Reject
          </button>
          <button
            onClick={() => onDecide('APPROVED')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors"
          >
            <CheckCircle className="w-3.5 h-3.5" /> Approve
          </button>
        </div>
      )}
    </div>
  );
}
