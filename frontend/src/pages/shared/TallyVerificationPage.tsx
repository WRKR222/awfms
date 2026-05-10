// src/pages/shared/TallyVerificationPage.tsx
// Shared by Manager (/manager/tally), Sales (/sales/tally), Store (/store/tally)
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { useAuthStore } from '../../stores/auth.store';
import { CheckCircle, Clock, Lock, AlertTriangle } from 'lucide-react';
import dayjs from 'dayjs';

interface TallySession {
  id: string;
  verificationDate: string;
  sessionId: string;
  // Attendant original counts (from EggCollectionSession via sessionId)
  attendantGoodEggs: number;
  attendantFullTrays: number;
  attendantLooseEggs: number;
  // Sign-off status
  pmSignedById?: string;
  pmSignedAt?: string;
  salesSignedById?: string;
  salesSignedAt?: string;
  storeSignedById?: string;
  storeSignedAt?: string;
  isLocked: boolean;
  lockedAt?: string;
  finalGoodEggs?: number;
  finalFullTrays?: number;
  expectedRevenueKes?: number;
  revenueSetAt?: string;
  // Session details
  session?: {
    houseId: string;
    shift: string;
    sessionDate: string;
    totalGoodEggs: number;
    totalFullTrays: number;
    totalLooseEggs: number;
    batch: { batchCode: string };
  };
}

function usePendingTallies() {
  return useQuery({
    queryKey: ['tally-pending'],
    queryFn: async () => {
      const res = await api.get('/tally-verifications/pending');
      return res.data as TallySession[];
    },
    refetchInterval: 30_000,
  });
}

function SignoffBadge({ label, signed }: { label: string; signed: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
      signed ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
    }`}>
      {signed ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
      {label}
    </div>
  );
}

function TallyCard({ tally }: { tally: TallySession }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const role = user?.role ?? '';

  const myField =
    role === 'MANAGER' ? 'pmSignedById' :
    role === 'SALES'   ? 'salesSignedById' :
    role === 'STORE'   ? 'storeSignedById' : null;

  const iAlreadySigned = myField ? !!(tally as any)[myField] : false;
  const canSign = !!myField && !iAlreadySigned && !tally.isLocked;

  const [correctedTrays, setCorrectedTrays]  = useState<string>('');
  const [correctedLoose, setCorrectedLoose]  = useState<string>('');
  const [showCorrection, setShowCorrection]  = useState(false);

  // Revenue fields (Accountant only — shown when tally is locked but revenue not set)
  const [expectedRevenue, setExpectedRevenue] = useState<string>('');

  const signoff = useMutation({
    mutationFn: () => {
      const body: any = {};
      if (correctedTrays !== '') body.correctedFullTrays = Number(correctedTrays);
      if (correctedLoose  !== '') body.correctedLooseEggs = Number(correctedLoose);
      return api.post(`/tally-verifications/${tally.sessionId}/sign`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tally-pending'] }),
  });

  const setRevenue = useMutation({
    mutationFn: () => api.patch(`/tally-verifications/${tally.sessionId}/revenue`, { expectedRevenueKes: Number(expectedRevenue) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tally-pending'] }),
  });

  const session = tally.session;
  const originalTrays = session?.totalFullTrays ?? 0;
  const originalLoose = session?.totalLooseEggs ?? 0;
  const originalGood  = session?.totalGoodEggs  ?? 0;

  return (
    <div className={`bg-white dark:bg-dark-card rounded-2xl border shadow-sm overflow-hidden ${
      tally.isLocked ? 'border-green-200 dark:border-green-800' : 'border-gray-100 dark:border-dark-border'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${
        tally.isLocked ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800/40'
      }`}>
        <div>
          <p className="text-sm font-bold text-gray-800 dark:text-gray-200">
            {session?.batch?.batchCode ?? '—'}
            <span className="ml-2 text-xs font-normal text-gray-500">
              {dayjs(tally.verificationDate).format('D MMM YYYY')}
            </span>
          </p>
          <p className="text-xs text-gray-500">PM Collection · {session?.shift} shift</p>
        </div>
        {tally.isLocked
          ? <div className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-semibold"><Lock className="w-3.5 h-3.5" /> Locked</div>
          : <div className="flex items-center gap-1 text-amber-500 text-xs font-semibold"><Clock className="w-3.5 h-3.5" /> Awaiting sign-offs</div>
        }
      </div>

      {/* Counts */}
      <div className="px-4 py-3 grid grid-cols-3 gap-3 border-b border-gray-100 dark:border-dark-border">
        <div className="text-center">
          <p className="text-xl font-bold text-brand-green">{tally.isLocked ? tally.finalFullTrays : originalTrays}</p>
          <p className="text-xs text-gray-400">{tally.isLocked ? 'Final' : 'Attd.'} Trays</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold text-gray-800 dark:text-gray-200">{tally.isLocked ? ((tally.finalGoodEggs ?? 0) - (tally.finalFullTrays ?? 0) * 30) : originalLoose}</p>
          <p className="text-xs text-gray-400">Loose Eggs</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold text-brand-teal">{tally.isLocked ? tally.finalGoodEggs : originalGood}</p>
          <p className="text-xs text-gray-400">Total Good</p>
        </div>
      </div>

      {/* Sign-off status pills */}
      <div className="px-4 py-3 flex gap-2 flex-wrap">
        <SignoffBadge label="PM"    signed={!!tally.pmSignedById} />
        <SignoffBadge label="Sales" signed={!!tally.salesSignedById} />
        <SignoffBadge label="Store" signed={!!tally.storeSignedById} />
      </div>

      {/* Revenue (locked tallies) */}
      {tally.isLocked && (
        <div className="px-4 pb-3">
          {tally.revenueSetAt ? (
            <p className="text-sm font-semibold text-brand-green">
              Expected Revenue: KES {Number(tally.expectedRevenueKes).toLocaleString()}
            </p>
          ) : role === 'ACCOUNTANT' ? (
            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={expectedRevenue}
                onChange={e => setExpectedRevenue(e.target.value)}
                placeholder="Set expected revenue (KES)"
                className="flex-1 rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2"
              />
              <button
                onClick={() => setRevenue.mutate()}
                disabled={!expectedRevenue || setRevenue.isPending}
                className="bg-brand-green text-white px-3 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {setRevenue.isPending ? '…' : 'Set'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">Awaiting Accountant to set expected revenue</p>
          )}
        </div>
      )}

      {/* My sign-off action */}
      {canSign && (
        <div className="px-4 pb-4 space-y-3">
          <button
            onClick={() => setShowCorrection(v => !v)}
            className="flex items-center gap-1 text-xs text-amber-500 hover:text-amber-600"
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Count is different — correct it
          </button>

          {showCorrection && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Corrected Full Trays</label>
                <input
                  type="number"
                  value={correctedTrays}
                  onChange={e => setCorrectedTrays(e.target.value)}
                  placeholder={String(originalTrays)}
                  className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Corrected Loose Eggs</label>
                <input
                  type="number"
                  value={correctedLoose}
                  onChange={e => setCorrectedLoose(e.target.value)}
                  placeholder={String(originalLoose)}
                  className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2"
                />
              </div>
            </div>
          )}

          <button
            onClick={() => signoff.mutate()}
            disabled={signoff.isPending}
            className="w-full bg-brand-green text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          >
            {signoff.isPending ? 'Confirming…' : '✓ Confirm & Sign Off'}
          </button>
        </div>
      )}

      {iAlreadySigned && !tally.isLocked && (
        <div className="px-4 pb-3">
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">✓ You have signed off — waiting for others</p>
        </div>
      )}
    </div>
  );
}

export default function TallyVerificationPage() {
  const { data: tallies = [], isLoading } = usePendingTallies();

  return (
    <div className="p-4 md:p-8 space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">Tally Verification</h1>
        <p className="text-xs text-gray-400 mt-0.5">Next-morning 3-party sign-off on previous day's PM egg tally</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-10">Loading tallies…</p>
      ) : tallies.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No pending tallies</p>
          <p className="text-xs mt-1">All recent tallies have been verified</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tallies.map(t => <TallyCard key={t.id} tally={t} />)}
        </div>
      )}
    </div>
  );
}
