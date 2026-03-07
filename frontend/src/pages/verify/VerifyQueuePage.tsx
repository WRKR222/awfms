import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CheckCircle, XCircle, Clock, AlertTriangle,
  ChevronRight, Users, Wheat, Egg,
} from 'lucide-react';
import { flockApi } from '../../lib/api/flock.api';
import { useAuthStore } from '../../stores/auth.store';

type EntryType = 'flock' | 'feed' | 'production';

interface PendingQueue {
  flock: FlockEntry[];
  feed: FeedEntry[];
  production: ProductionEntry[];
  totalPending: number;
}
interface FlockEntry { id: string; batchId: string; entryDate: string; openingCount: number; deaths: number; culls: number; closingCount: number; deathCause?: string; notes?: string; submittedBy: { username: string }; batch: { batchCode: string; house: { name: string } }; }
interface FeedEntry { id: string; batchId: string; logDate: string; feedType: string; feedingTime: string; quantityDispensedKg: string; wastageKg: string; recommendedMinKg?: string; recommendedMaxKg?: string; submittedBy: { username: string }; batch: { batchCode: string; house: { name: string } }; }
interface ProductionEntry { id: string; batchId: string; entryDate: string; collectionTime: string; totalWhole: number; henDayPct?: string; gradeXl: number; gradeL: number; gradeM: number; gradeS: number; gradeReject: number; submittedBy: { username: string }; batch: { batchCode: string; house: { name: string } }; }

export default function VerifyQueuePage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<EntryType>('flock');
  const [returnModalOpen, setReturnModalOpen] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState('');

  const { data: queue, isLoading } = useQuery<PendingQueue>({
    queryKey: ['verification-queue'],
    queryFn: flockApi.getPendingQueue,
    refetchInterval: 30_000, // Auto-refresh every 30s
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => flockApi.verifyFlockEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['verification-queue'] }),
  });

  const returnMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      flockApi.returnFlockEntry(id, note),
    onSuccess: () => {
      setReturnModalOpen(null);
      setRejectionNote('');
      queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
    },
  });

  const totalPending = queue?.totalPending ?? 0;

  const tabs: { key: EntryType; label: string; icon: typeof Users; count: number }[] = [
    { key: 'flock',      label: 'Bird Count', icon: Users, count: queue?.flock.length ?? 0 },
    { key: 'feed',       label: 'Feed',        icon: Wheat, count: queue?.feed.length ?? 0 },
    { key: 'production', label: 'Eggs',        icon: Egg,   count: queue?.production.length ?? 0 },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Verification Queue</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {totalPending === 0
            ? '✓ All entries verified — queue is clear'
            : `${totalPending} ${totalPending === 1 ? 'entry' : 'entries'} waiting for your review`}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm whitespace-nowrap transition-colors
              ${activeTab === key
                ? 'bg-green-700 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
          >
            <Icon size={16} />
            {label}
            {count > 0 && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full
                ${activeTab === key ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Entry cards */}
      {activeTab === 'flock' && (
        <div className="space-y-3">
          {(queue?.flock ?? []).length === 0 ? (
            <EmptyState type="bird count" />
          ) : (
            queue?.flock.map(entry => (
              <FlockEntryCard
                key={entry.id}
                entry={entry}
                onVerify={() => verifyMutation.mutate({ id: entry.id })}
                onReturn={() => { setReturnModalOpen(entry.id); setRejectionNote(''); }}
                isVerifying={verifyMutation.isPending && verifyMutation.variables?.id === entry.id}
              />
            ))
          )}
        </div>
      )}

      {activeTab === 'feed' && (
        <div className="space-y-3">
          {(queue?.feed ?? []).length === 0 ? <EmptyState type="feed" /> : (
            queue?.feed.map(entry => (
              <FeedEntryCard key={entry.id} entry={entry} />
            ))
          )}
        </div>
      )}

      {activeTab === 'production' && (
        <div className="space-y-3">
          {(queue?.production ?? []).length === 0 ? <EmptyState type="egg collection" /> : (
            queue?.production.map(entry => (
              <ProductionEntryCard key={entry.id} entry={entry} />
            ))
          )}
        </div>
      )}

      {/* Return modal */}
      {returnModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-2">Return entry for correction</h3>
            <p className="text-sm text-gray-500 mb-4">
              Explain what the attendant needs to fix. They will see this note.
            </p>
            <textarea
              value={rejectionNote}
              onChange={(e) => setRejectionNote(e.target.value)}
              placeholder="E.g. Deaths exceed opening count. Please recheck and resubmit."
              className="w-full border border-gray-300 rounded-xl p-3 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setReturnModalOpen(null); setRejectionNote(''); }}
                className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => returnModalOpen && returnMutation.mutate({ id: returnModalOpen, note: rejectionNote })}
                disabled={!rejectionNote.trim() || returnMutation.isPending}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold rounded-xl text-sm transition-colors"
              >
                Return for correction
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ type }: { type: string }) {
  return (
    <div className="text-center py-12 bg-white rounded-2xl border border-green-100">
      <CheckCircle size={40} className="mx-auto text-green-500 mb-3" />
      <p className="font-medium text-gray-700">No pending {type} entries</p>
      <p className="text-sm text-gray-400 mt-1">All submissions are verified</p>
    </div>
  );
}

function VerifyButtons({
  onVerify, onReturn, isVerifying,
}: { onVerify: () => void; onReturn: () => void; isVerifying: boolean }) {
  return (
    <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
      <button
        onClick={onReturn}
        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-amber-300 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-50 transition-colors"
      >
        <XCircle size={16} /> Return
      </button>
      <button
        onClick={onVerify}
        disabled={isVerifying}
        className="flex-2 flex-[2] flex items-center justify-center gap-1.5 py-2.5 bg-green-700 hover:bg-green-800 disabled:bg-green-400 text-white rounded-xl text-sm font-semibold transition-colors"
      >
        {isVerifying
          ? <><Clock size={16} className="animate-pulse" /> Verifying...</>
          : <><CheckCircle size={16} /> Approve</>}
      </button>
    </div>
  );
}

function FlockEntryCard({ entry, onVerify, onReturn, isVerifying }: {
  entry: FlockEntry;
  onVerify: () => void;
  onReturn: () => void;
  isVerifying: boolean;
}) {
  const mortalityRate = entry.openingCount > 0
    ? ((entry.deaths / entry.openingCount) * 100).toFixed(2)
    : '0';
  const isHighMortality = parseFloat(mortalityRate) > 2;

  return (
    <div className={`bg-white rounded-2xl border p-4 ${isHighMortality ? 'border-amber-300 bg-amber-50' : 'border-green-100'}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm">{entry.batch.batchCode}</span>
            <span className="text-xs text-gray-400">{entry.batch.house.name}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {new Date(entry.entryDate).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}
            {' · '}Submitted by <strong>{entry.submittedBy.username}</strong>
          </p>
        </div>
        {isHighMortality && (
          <span className="flex items-center gap-1 text-xs text-amber-700 font-medium bg-amber-100 px-2 py-1 rounded-lg">
            <AlertTriangle size={12} /> High mortality
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatBox label="Opening" value={entry.openingCount.toString()} />
        <StatBox label="Deaths" value={entry.deaths.toString()} highlight={entry.deaths > 0} />
        <StatBox label="Closing" value={entry.closingCount.toString()} />
      </div>

      {entry.deathCause && (
        <p className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg px-3 py-2">
          <strong>Cause:</strong> {entry.deathCause}
        </p>
      )}

      <VerifyButtons onVerify={onVerify} onReturn={onReturn} isVerifying={isVerifying} />
    </div>
  );
}

function FeedEntryCard({ entry }: { entry: FeedEntry }) {
  const qty = parseFloat(entry.quantityDispensedKg);
  const minRec = entry.recommendedMinKg ? parseFloat(entry.recommendedMinKg) : null;
  const maxRec = entry.recommendedMaxKg ? parseFloat(entry.recommendedMaxKg) : null;
  const isOutOfRange = minRec && maxRec && (qty < minRec || qty > maxRec);

  return (
    <div className={`bg-white rounded-2xl border p-4 ${isOutOfRange ? 'border-amber-300' : 'border-green-100'}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="font-semibold text-gray-900 text-sm">{entry.batch.batchCode}</span>
          <span className="text-xs text-gray-400 ml-2">{entry.batch.house.name}</span>
          <p className="text-xs text-gray-500 mt-0.5">
            {entry.feedType.replace('_', ' ')} · {entry.feedingTime}
            {' · '}{entry.submittedBy.username}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="Dispensed (kg)" value={qty.toFixed(1)} highlight={!!isOutOfRange} />
        <StatBox label="Wastage (kg)" value={parseFloat(entry.wastageKg).toFixed(1)} />
      </div>
      {minRec && maxRec && (
        <p className="text-xs text-gray-400 mt-2">
          Recommended range: {minRec.toFixed(0)}–{maxRec.toFixed(0)} kg
          {isOutOfRange && <span className="text-amber-600 font-medium"> ⚠ Outside range</span>}
        </p>
      )}
    </div>
  );
}

function ProductionEntryCard({ entry }: { entry: ProductionEntry }) {
  const henDayPct = entry.henDayPct ? parseFloat(entry.henDayPct) : null;
  const isLowProduction = henDayPct !== null && henDayPct < 70;

  return (
    <div className={`bg-white rounded-2xl border p-4 ${isLowProduction ? 'border-amber-300' : 'border-green-100'}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="font-semibold text-gray-900 text-sm">{entry.batch.batchCode}</span>
          <span className="text-xs text-gray-400 ml-2">{entry.collectionTime} collection</span>
          <p className="text-xs text-gray-500 mt-0.5">{entry.submittedBy.username}</p>
        </div>
        {henDayPct !== null && (
          <span className={`text-sm font-bold ${henDayPct >= 80 ? 'text-green-700' : henDayPct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
            {henDayPct.toFixed(1)}%
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="Total eggs" value={entry.totalWhole.toString()} />
        <StatBox label="Hen-day %" value={henDayPct ? `${henDayPct.toFixed(1)}%` : '—'} highlight={isLowProduction} />
      </div>
    </div>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-2.5 text-center ${highlight ? 'bg-amber-50' : 'bg-gray-50'}`}>
      <p className={`text-base font-bold ${highlight ? 'text-amber-700' : 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
