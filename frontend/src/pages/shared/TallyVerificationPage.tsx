// src/pages/shared/TallyVerificationPage.tsx
// Shared by Manager (/manager/tally), Sales (/sales/tally), Store (/store/tally)
//
// IMPLEMENTATION PLAN CHANGES:
//   • Tally cards grouped by sessionDate+batchId — AM and PM cards shown together.
//   • Each card retains its own independent sign-off buttons.
//   • Tallies only arrive from backend once both AM+PM sessions are APPROVED
//     (enforced by tally creation logic in production.service), so no frontend
//     filtering required.
//   • FIX-5: Title and description retained from previous fix.
//   • FIX-6: "PM Collection" → "Egg Collection" label retained.
//   • FIX-7: PM editable row table retained.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { useAuthStore } from '../../stores/auth.store';
import { CheckCircle, Clock, Lock, AlertTriangle, Edit2, Save, X } from 'lucide-react';
import dayjs from 'dayjs';

interface RowData {
  rowCode: string;
  totalEggs: number;
  starterEggs: number;
  brokenSellable: number;
  brokenUnsellable: number;
  softShell: number;
  deformed: number;
  weightKg: number;
  attendantName?: string;
}

interface TallySession {
  id: string;
  verificationDate: string;
  sessionId: string;
  attendantGoodEggs: number;
  attendantFullTrays: number;
  attendantLooseEggs: number;
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
  session?: {
    houseId: string;
    shift: string;
    sessionDate: string;
    totalGoodEggs: number;
    totalFullTrays: number;
    totalLooseEggs: number;
    totalStarterEggs?: number;
    totalBrokenSellable?: number;
    totalBrokenUnsellable?: number;
    totalBrokenEggs?: number;
    totalSoftShell?: number;
    totalDeformed?: number;
    totalWeightKg?: number;
    rowData?: RowData[];
    batch: { batchCode: string };
    batchId: string;
    status: string;
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

function SignoffBadge({ label, signed, signedAt }: { label: string; signed: boolean; signedAt?: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
      signed ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
    }`}>
      {signed ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
      {label}
      {signed && signedAt && <span className="opacity-60 text-[10px]">{dayjs(signedAt).format('HH:mm')}</span>}
    </div>
  );
}

function StatCell({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-xl font-bold ${highlight ? 'text-brand-green' : 'text-gray-800 dark:text-gray-200'}`}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

function TallyCard({ tally }: { tally: TallySession }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const role = user?.role ?? '';

  const isPM    = role === 'MANAGER' || role === 'OWNER';
  const isSales = role === 'SALES';
  const isStore = role === 'STORE';

  const myField =
    isPM    ? 'pmSignedById' :
    isSales ? 'salesSignedById' :
    isStore ? 'storeSignedById' : null;

  const iAlreadySigned = myField ? !!(tally as any)[myField] : false;

  // FIX: Enforce sign order — SALES waits for PM, STORE waits for PM+SALES
  const prerequisitesMet =
    isPM    ? true :
    isSales ? !!tally.pmSignedById :
    isStore ? (!!tally.pmSignedById && !!tally.salesSignedById) :
    false;

  const prerequisiteLabel =
    isSales && !tally.pmSignedById ? 'Waiting for Production Manager to sign first' :
    isStore && !tally.pmSignedById ? 'Waiting for Production Manager to sign first' :
    isStore && !tally.salesSignedById ? 'Waiting for Sales to sign first' :
    null;

  const canSign = !!myField && !iAlreadySigned && !tally.isLocked && prerequisitesMet;

  const [isEditing, setIsEditing] = useState(false);
  const session = tally.session;
  const originalRows: RowData[] = Array.isArray(session?.rowData) ? session!.rowData : [];
  // editRows stores string values during editing so the user can clear a zero
  // and type a fresh number (e.g. "0" → "" → "2") without the field forcing
  // a numeric parse on every keystroke.
  const [editRows, setEditRows] = useState<Record<string, string | number>[]>([]);

  const [correctedTrays, setCorrectedTrays]  = useState<string>('');
  const [correctedLoose, setCorrectedLoose]  = useState<string>('');
  const [showCorrection, setShowCorrection]  = useState(false);

  const [expectedRevenue, setExpectedRevenue] = useState<string>('');

  const editMutation = useMutation({
    mutationFn: (rows: RowData[]) =>
      api.put(`/tally-verifications/${tally.sessionId}/edit`, { rowData: rows }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tally-pending'] });
      setIsEditing(false);
    },
  });

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

  const originalTrays = session?.totalFullTrays ?? 0;
  const originalGood  = session?.totalGoodEggs  ?? 0;
  // Derive loose eggs from the authoritative formula (goodEggs % 30) rather than
  // relying on totalLooseEggs alone — the listPending select previously omitted
  // that field so it arrived as undefined and rendered as 0.
  const originalLoose = session?.totalLooseEggs != null
    ? session.totalLooseEggs
    : originalGood - originalTrays * 30;

  const startEdit = () => {
    // Store all numeric fields as strings so inputs start empty-able
    setEditRows(originalRows.map(r => ({
      rowCode: r.rowCode,
      totalEggs: String(r.totalEggs ?? 0),
      starterEggs: String(r.starterEggs ?? 0),
      brokenSellable: String(r.brokenSellable ?? 0),
      brokenUnsellable: String(r.brokenUnsellable ?? 0),
      softShell: String(r.softShell ?? 0),
      deformed: String(r.deformed ?? 0),
      weightKg: String(r.weightKg ?? 0),
      attendantName: r.attendantName ?? '',
    })));
    setIsEditing(true);
  };

  const updateEditRow = (idx: number, field: string, value: string) => {
    setEditRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  // Convert string edit rows back to numbers for the API call
  const buildRowDataForSave = () =>
    editRows.map(r => ({
      rowCode: r.rowCode as string,
      totalEggs: Number(r.totalEggs) || 0,
      starterEggs: Number(r.starterEggs) || 0,
      brokenSellable: Number(r.brokenSellable) || 0,
      brokenUnsellable: Number(r.brokenUnsellable) || 0,
      softShell: Number(r.softShell) || 0,
      deformed: Number(r.deformed) || 0,
      weightKg: Number(r.weightKg) || 0,
      attendantName: r.attendantName as string,
    }));

  const shiftLabel = session?.shift ?? '—';
  const shiftColor = shiftLabel === 'AM'
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';

  return (
    <div className={`bg-white dark:bg-dark-card rounded-2xl border shadow-sm overflow-hidden ${
      tally.isLocked ? 'border-green-200 dark:border-green-800' : 'border-gray-100 dark:border-dark-border'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${
        tally.isLocked ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800/40'
      }`}>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-gray-800 dark:text-gray-200">
              {session?.batch?.batchCode ?? '—'}
              <span className="ml-2 text-xs font-normal text-gray-500">
                {dayjs(tally.verificationDate).format('D MMM YYYY')}
              </span>
            </p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${shiftColor}`}>
              {shiftLabel}
            </span>
          </div>
          <p className="text-xs text-gray-500">Egg Collection · {shiftLabel} shift</p>
        </div>
        {tally.isLocked
          ? <div className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-semibold"><Lock className="w-3.5 h-3.5" /> Locked</div>
          : <div className="flex items-center gap-1 text-amber-500 text-xs font-semibold"><Clock className="w-3.5 h-3.5" /> Awaiting sign-offs</div>
        }
      </div>

      {/* Session totals grid */}
      <div className="px-4 py-4 border-b border-gray-100 dark:border-dark-border">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Egg Collection Totals</p>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          <StatCell label={tally.isLocked ? 'Final Full Trays' : 'Attd. Full Trays'} value={tally.isLocked ? (tally.finalFullTrays ?? 0) : originalTrays} highlight />
          <StatCell label="Loose Eggs" value={tally.isLocked ? ((tally.finalGoodEggs ?? 0) - (tally.finalFullTrays ?? 0) * 30) : originalLoose} />
          <StatCell label="Total Good" value={tally.isLocked ? (tally.finalGoodEggs ?? 0) : originalGood} highlight />
          {session?.totalStarterEggs != null && <StatCell label="Starter Eggs" value={session.totalStarterEggs} />}
          {session?.totalBrokenSellable != null && <StatCell label="Broken (Sell)" value={session.totalBrokenSellable} />}
          {session?.totalBrokenUnsellable != null && <StatCell label="Broken (Unsell)" value={session.totalBrokenUnsellable} />}
          {session?.totalSoftShell != null && <StatCell label="Soft Shell" value={session.totalSoftShell} />}
          {session?.totalDeformed != null && <StatCell label="Deformed" value={session.totalDeformed} />}
          {session?.totalWeightKg != null && <StatCell label="Weight (kg)" value={Number(session.totalWeightKg).toFixed(1)} />}
        </div>
      </div>

      {/* Per-row breakdown */}
      {originalRows.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-dark-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Per-Row Breakdown (Block 1 Units)</p>
            {isPM && !tally.isLocked && !isEditing && (
              <button onClick={startEdit} className="flex items-center gap-1 text-xs text-brand-green hover:text-green-700 font-semibold">
                <Edit2 className="w-3 h-3" /> Edit Values
              </button>
            )}
            {isPM && isEditing && (
              <div className="flex gap-2">
                <button onClick={() => editMutation.mutate(buildRowDataForSave())} disabled={editMutation.isPending}
                  className="flex items-center gap-1 text-xs bg-brand-green text-white px-2 py-1 rounded-lg font-semibold disabled:opacity-50">
                  <Save className="w-3 h-3" /> {editMutation.isPending ? 'Saving…' : 'Save & Update All'}
                </button>
                <button onClick={() => setIsEditing(false)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg border border-gray-200 dark:border-dark-border">
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            )}
          </div>
          {isPM && isEditing ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100 dark:border-dark-border">
                    <th className="text-left py-1.5 pr-2 font-medium">Row</th>
                    <th className="text-right py-1.5 px-1 font-medium">Total Eggs</th>
                    <th className="text-right py-1.5 px-1 font-medium">Starter</th>
                    <th className="text-right py-1.5 px-1 font-medium">Broken (S)</th>
                    <th className="text-right py-1.5 px-1 font-medium">Broken (U)</th>
                    <th className="text-right py-1.5 px-1 font-medium">Soft Shell</th>
                    <th className="text-right py-1.5 px-1 font-medium">Deformed</th>
                    <th className="text-right py-1.5 px-1 font-medium">Weight(kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {editRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-dark-border/50">
                      <td className="py-1.5 pr-2">
                        <span className="font-bold text-brand-green bg-brand-green/10 rounded px-2 py-0.5">{row.rowCode as string}</span>
                      </td>
                      {(['totalEggs', 'starterEggs', 'brokenSellable', 'brokenUnsellable', 'softShell', 'deformed'] as const).map(field => (
                        <td key={field} className="px-1 py-1">
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={row[field] as string}
                            onChange={e => updateEditRow(i, field, e.target.value)}
                            onFocus={e => e.target.select()}
                            placeholder="0"
                            className="w-16 text-right rounded border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-green"
                          />
                        </td>
                      ))}
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          inputMode="decimal"
                          value={row.weightKg as string}
                          onChange={e => updateEditRow(i, 'weightKg', e.target.value)}
                          onFocus={e => e.target.select()}
                          placeholder="0"
                          className="w-16 text-right rounded border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-green"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Saving will update all parties' views and reset all sign-offs. Everyone must re-sign.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100 dark:border-dark-border">
                    <th className="text-left py-1.5 pr-3 font-medium">Row</th>
                    <th className="text-right py-1.5 px-2 font-medium">Total Eggs</th>
                    <th className="text-right py-1.5 px-2 font-medium">Starter</th>
                    <th className="text-right py-1.5 px-2 font-medium">Broken (S)</th>
                    <th className="text-right py-1.5 px-2 font-medium">Broken (U)</th>
                    <th className="text-right py-1.5 px-2 font-medium">Soft Shell</th>
                    <th className="text-right py-1.5 px-2 font-medium">Deformed</th>
                    <th className="text-right py-1.5 px-2 font-medium">Weight(kg)</th>
                    <th className="text-left py-1.5 pl-2 font-medium">Attendant</th>
                  </tr>
                </thead>
                <tbody>
                  {originalRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-dark-border/50">
                      <td className="py-1.5 pr-3">
                        <span className="font-bold text-brand-green bg-brand-green/10 rounded px-2 py-0.5">{row.rowCode}</span>
                      </td>
                      <td className="text-right px-2 font-semibold text-gray-700 dark:text-gray-200">{row.totalEggs}</td>
                      <td className="text-right px-2 text-blue-500">{row.starterEggs ?? 0}</td>
                      <td className="text-right px-2 text-amber-500">{row.brokenSellable ?? 0}</td>
                      <td className={`text-right px-2 ${(row.brokenUnsellable ?? 0) > 3 ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>{row.brokenUnsellable ?? 0}</td>
                      <td className={`text-right px-2 ${(row.softShell ?? 0) > 3 ? 'text-amber-500 font-semibold' : 'text-gray-500'}`}>{row.softShell ?? 0}</td>
                      <td className="text-right px-2 text-gray-500">{row.deformed ?? 0}</td>
                      <td className="text-right px-2 text-gray-500">{Number(row.weightKg ?? 0).toFixed(1)}</td>
                      <td className="text-left pl-2 text-gray-400">{row.attendantName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(isSales || isStore) && (
                <p className="text-[10px] text-gray-400 italic mt-1.5">Read-only — only Production Manager may edit row data.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sign-off status pills */}
      <div className="px-4 py-3 flex gap-2 flex-wrap border-b border-gray-100 dark:border-dark-border">
        <SignoffBadge label="PM" signed={!!tally.pmSignedById} signedAt={tally.pmSignedAt} />
        <SignoffBadge label="Sales" signed={!!tally.salesSignedById} signedAt={tally.salesSignedAt} />
        <SignoffBadge label="Store" signed={!!tally.storeSignedById} signedAt={tally.storeSignedAt} />
      </div>

      {/* Revenue (locked tallies) */}
      {tally.isLocked && (
        <div className="px-4 pb-3 pt-3">
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
          {isPM && (
            <button
              onClick={() => setShowCorrection(v => !v)}
              className="flex items-center gap-1 text-xs text-amber-500 hover:text-amber-600"
            >
              <AlertTriangle className="w-3.5 h-3.5" /> Count is different — correct it
            </button>
          )}

          {isPM && showCorrection && (
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

      {/* FIX: Show prerequisite message when sign order not met yet */}
      {!iAlreadySigned && !canSign && !tally.isLocked && prerequisiteLabel && (
        <div className="px-4 pb-3">
          <p className="text-xs text-amber-500 dark:text-amber-400 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {prerequisiteLabel}
          </p>
        </div>
      )}
    </div>
  );
}

// Group tallies by date+batchId and render AM before PM within each group
function groupTallies(tallies: TallySession[]): TallySession[][] {
  const map = new Map<string, TallySession[]>();
  for (const t of tallies) {
    const key = `${t.session?.sessionDate ?? t.verificationDate}_${t.session?.batchId ?? ''}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  // Within each group sort AM before PM
  return Array.from(map.values()).map(group =>
    [...group].sort((a, b) => {
      const shiftOrder = (s: TallySession) => s.session?.shift === 'AM' ? 0 : 1;
      return shiftOrder(a) - shiftOrder(b);
    })
  );
}

export default function TallyVerificationPage() {
  const { data: tallies = [], isLoading } = usePendingTallies();
  const groups = groupTallies(tallies as TallySession[]);

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Next Morning Three-Party Sign-Off</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Next morning three party sign off on previous day AM and PM egg collection sessions
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-10">Loading tallies…</p>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No pending sign-offs</p>
          <p className="text-xs mt-1">All recent AM and PM egg collection sessions have been verified</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group, gi) => {
            const firstSession = group[0].session;
            const dateLabel = firstSession?.sessionDate
              ? dayjs(firstSession.sessionDate).format('dddd, D MMMM YYYY')
              : dayjs(group[0].verificationDate).subtract(1, 'day').format('dddd, D MMMM YYYY');
            const batchCode = firstSession?.batch?.batchCode ?? '—';
            return (
              <div key={gi}>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                    {dateLabel} — {batchCode}
                  </p>
                  <div className="flex-1 border-t border-gray-100 dark:border-dark-border" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {group.map(t => <TallyCard key={t.id} tally={t} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
