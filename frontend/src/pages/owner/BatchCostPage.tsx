// src/pages/owner/BatchCostPage.tsx
// Director — cost per day for any existing batch (feed, vaccines/supplements,
// treatments), sourced from GET /finance/batches/:batchId/daily-cost. Lets the
// Director pick any batch (active or closed) and an optional date range, and
// see a day-by-day cost breakdown plus a running total for the batch.
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Wallet, Layers, Calendar, RefreshCw } from 'lucide-react';
import dayjs from '../../lib/dayjs';

const C = { feed: '#22c55e', vacc: '#60a5fa', treat: '#f87171' };

function money(n: number) {
  return `KES ${Number(n ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Batch {
  id: string;
  batchCode: string;
  birdType: string;
  stage: string;
  isActive: boolean;
  dateReceived: string;
}

interface DailyCostDay {
  date: string;
  feedCostKes: number;
  vaccineSupplementCostKes: number;
  treatmentCostKes: number;
  totalCostKes: number;
}

interface DailyCostResponse {
  batch: { id: string; batchCode: string };
  from: string;
  to: string;
  days: DailyCostDay[];
  totalCostKes: number;
}

function useBatches() {
  return useQuery<Batch[]>({
    queryKey: ['flock', 'batches', 'all'],
    queryFn: async () => (await api.get('/flock/batches')).data,
  });
}

function useBatchDailyCost(batchId: string, from: string, to: string) {
  return useQuery<DailyCostResponse>({
    queryKey: ['finance', 'batch-daily-cost', batchId, from, to],
    queryFn: async () =>
      (await api.get(`/finance/batches/${batchId}/daily-cost`, { params: { from, to } })).data,
    enabled: !!batchId,
  });
}

export default function BatchCostPage() {
  const { data: batches, isLoading: batchesLoading } = useBatches();
  const [batchId, setBatchId] = useState('');
  const [from, setFrom] = useState(dayjs().subtract(29, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));

  const effectiveBatchId = batchId || batches?.[0]?.id || '';
  const { data, isLoading, isFetching, refetch } = useBatchDailyCost(effectiveBatchId, from, to);

  const selectedBatch = useMemo(
    () => batches?.find(b => b.id === effectiveBatchId),
    [batches, effectiveBatchId],
  );

  const chartData = (data?.days ?? []).map(d => ({
    date: dayjs(d.date).format('DD MMM'),
    Feed: Number(d.feedCostKes ?? 0),
    'Vaccines/Supplements': Number(d.vaccineSupplementCostKes ?? 0),
    Treatments: Number(d.treatmentCostKes ?? 0),
  }));

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Wallet className="w-5 h-5 text-brand-green" />
          Batch Cost — Per Day
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Feed, vaccine/supplement and treatment cost for any batch, broken down by day. Pick a
          batch and a date range below.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-dark-card rounded-xl border border-gray-100 dark:border-dark-border p-4 flex flex-wrap items-end gap-4">
        <div className="min-w-[220px] flex-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-1">
            <Layers className="w-3.5 h-3.5" /> Batch
          </label>
          <select
            value={effectiveBatchId}
            onChange={e => setBatchId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-bg text-sm"
          >
            {batchesLoading && <option>Loading…</option>}
            {batches?.map(b => (
              <option key={b.id} value={b.id}>
                {b.batchCode} — {b.birdType} ({b.isActive ? b.stage : 'closed'})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-1">
            <Calendar className="w-3.5 h-3.5" /> From
          </label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={e => setFrom(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-bg text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-1">
            <Calendar className="w-3.5 h-3.5" /> To
          </label>
          <input
            type="date"
            value={to}
            min={from}
            max={dayjs().format('YYYY-MM-DD')}
            onChange={e => setTo(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-bg text-sm"
          />
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-green/10 text-brand-green text-sm font-medium hover:bg-brand-green/20"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {!effectiveBatchId && !batchesLoading && (
        <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-10">
          No batches found.
        </div>
      )}

      {effectiveBatchId && (
        <>
          {/* Summary banner */}
          <div className="bg-white dark:bg-dark-card rounded-xl border border-gray-100 dark:border-dark-border p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {selectedBatch?.batchCode ?? data?.batch?.batchCode} — total cost, {from} to {to}
              </p>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {isLoading ? '…' : money(data?.totalCostKes ?? 0)}
              </p>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Feed</p>
                <p className="font-semibold" style={{ color: C.feed }}>
                  {money((data?.days ?? []).reduce((s, d) => s + Number(d.feedCostKes ?? 0), 0))}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Vaccines/Supplements</p>
                <p className="font-semibold" style={{ color: C.vacc }}>
                  {money((data?.days ?? []).reduce((s, d) => s + Number(d.vaccineSupplementCostKes ?? 0), 0))}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Treatments</p>
                <p className="font-semibold" style={{ color: C.treat }}>
                  {money((data?.days ?? []).reduce((s, d) => s + Number(d.treatmentCostKes ?? 0), 0))}
                </p>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white dark:bg-dark-card rounded-xl border border-gray-100 dark:border-dark-border p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Daily Cost Breakdown</h2>
            {isLoading ? (
              <div className="h-72 flex items-center justify-center text-sm text-gray-400">Loading…</div>
            ) : chartData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-sm text-gray-400">No cost data in this range.</div>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => money(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Feed" stackId="a" fill={C.feed} />
                    <Bar dataKey="Vaccines/Supplements" stackId="a" fill={C.vacc} />
                    <Bar dataKey="Treatments" stackId="a" fill={C.treat} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-dark-card rounded-xl border border-gray-100 dark:border-dark-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-dark-bg text-gray-500 dark:text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-right px-4 py-2">Feed</th>
                    <th className="text-right px-4 py-2">Vaccines/Supplements</th>
                    <th className="text-right px-4 py-2">Treatments</th>
                    <th className="text-right px-4 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
                  {(data?.days ?? []).map(d => (
                    <tr key={d.date}>
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{dayjs(d.date).format('DD MMM YYYY')}</td>
                      <td className="px-4 py-2 text-right">{money(d.feedCostKes)}</td>
                      <td className="px-4 py-2 text-right">{money(d.vaccineSupplementCostKes)}</td>
                      <td className="px-4 py-2 text-right">{money(d.treatmentCostKes)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-800 dark:text-gray-100">{money(d.totalCostKes)}</td>
                    </tr>
                  ))}
                  {(data?.days ?? []).length === 0 && !isLoading && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-400">No records for this range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
