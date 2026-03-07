import { useState } from 'react';
import { Check, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { usePendingEntries, useVerifyEntry } from '../../hooks/useFlock';
import dayjs from 'dayjs';

export function VerificationQueue() {
  const { data: pending = [], isLoading, refetch } = usePendingEntries();
  const verify = useVerifyEntry();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [returning, setReturning] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    await verify.mutateAsync({ id, data: { status: 'APPROVED' } });
    refetch();
  };

  const handleReturn = async (id: string) => {
    if (!returnReason.trim()) return;
    await verify.mutateAsync({ id, data: { status: 'RETURNED', returnReason } });
    setReturning(null);
    setReturnReason('');
    refetch();
  };

  if (isLoading) return <div className="p-6 text-center text-gray-500">Loading entries...</div>;

  if (pending.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-800">All Clear!</h2>
        <p className="text-gray-500 mt-2">No entries waiting for verification.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-gray-800">Verification Queue</h2>
        <span className="bg-amber-500 text-white text-sm font-bold px-3 py-1 rounded-full">
          {pending.length}
        </span>
      </div>

      {pending.map((entry: any) => {
        const isExpanded = expanded === entry.id;
        const isReturning = returning === entry.id;

        return (
          <div key={entry.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Entry header */}
            <button
              onClick={() => setExpanded(isExpanded ? null : entry.id)}
              className="w-full p-4 flex items-center gap-3 text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800">
                  {entry.submittedBy?.fullName}
                </p>
                <p className="text-sm text-gray-500">
                  {entry.batch?.batchCode} · {dayjs(entry.entryDate).format('D MMM')} · {entry.shift} shift
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Submitted {dayjs(entry.createdAt).fromNow()}
                </p>
              </div>
              {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />}
            </button>

            {/* Entry details */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-4 border-t border-gray-50">
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { label: 'Opening', value: entry.openingCount },
                    { label: 'Deaths', value: entry.mortalityCount, alert: entry.mortalityCount > 5 },
                    { label: 'Closing', value: entry.closingCount },
                  ].map(({ label, value, alert }) => (
                    <div key={label} className={`rounded-xl p-3 text-center ${alert ? 'bg-red-50' : 'bg-gray-50'}`}>
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className={`text-xl font-bold ${alert ? 'text-red-600' : 'text-gray-800'}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {entry.mortalityCause && (
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Cause:</span> {entry.mortalityCause.replace(/_/g, ' ')}
                  </p>
                )}
                {entry.notes && (
                  <p className="text-sm text-gray-600 bg-gray-50 rounded-xl p-3">{entry.notes}</p>
                )}

                {/* Return reason input */}
                {isReturning && (
                  <div>
                    <label className="block text-sm font-semibold text-red-700 mb-1">
                      Reason for returning (required)
                    </label>
                    <textarea
                      value={returnReason}
                      onChange={e => setReturnReason(e.target.value)}
                      rows={2}
                      className="w-full border-2 border-red-200 rounded-xl px-3 py-2 text-base resize-none"
                      placeholder="Explain what needs to be corrected..."
                    />
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3">
                  {!isReturning ? (
                    <>
                      <button
                        onClick={() => handleApprove(entry.id)}
                        disabled={verify.isPending}
                        className="flex-1 bg-green-600 text-white rounded-xl py-3 font-bold flex items-center justify-center gap-2 min-h-[52px] disabled:opacity-60"
                      >
                        <Check className="w-5 h-5" />
                        Approve
                      </button>
                      <button
                        onClick={() => setReturning(entry.id)}
                        className="flex-1 bg-red-50 text-red-600 border-2 border-red-200 rounded-xl py-3 font-bold flex items-center justify-center gap-2 min-h-[52px]"
                      >
                        <RotateCcw className="w-5 h-5" />
                        Return
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleReturn(entry.id)}
                        disabled={!returnReason.trim() || verify.isPending}
                        className="flex-1 bg-red-600 text-white rounded-xl py-3 font-bold min-h-[52px] disabled:opacity-40"
                      >
                        Confirm Return
                      </button>
                      <button
                        onClick={() => { setReturning(null); setReturnReason(''); }}
                        className="flex-1 bg-gray-100 text-gray-600 rounded-xl py-3 font-bold min-h-[52px]"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
