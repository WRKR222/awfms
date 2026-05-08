import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import dayjs from 'dayjs';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, ScatterChart, Scatter,
  ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { TrendingUp, Egg, AlertTriangle, Wheat, DollarSign, RefreshCw } from 'lucide-react';

// ── Palette ──────────────────────────────────────────────────────────────────
const COLORS = ['#16a34a', '#0d9488', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be185d'];

const RANGES = [
  { label: 'Today',   value: 'today' },
  { label: '7 Days',  value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
];

interface Props { role: 'OWNER' | 'MANAGER' }

// ── Reusable card ─────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'brand-green' }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 rounded-xl bg-${color}/10 flex items-center justify-center`}>
          <Icon className={`w-5 h-5 text-${color}`} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-800">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ── Short date formatter ──────────────────────────────────────────────────────
function shortDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function AnalyticsDashboard({ role }: Props) {
  const [range, setRange] = useState('30d');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics', range],
    queryFn: () => api.get(`/dashboard/analytics?range=${range}`).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: projData } = useQuery({
    queryKey: ['analytics-projection'],
    queryFn: () => api.get('/dashboard/analytics/projection').then(r => r.data),
    staleTime: 15 * 60 * 1000,
    enabled: role === 'OWNER',
  });

  if (isLoading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-8 h-8 border-4 border-brand-green border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading analytics…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-gray-500">Failed to load analytics</p>
        <button onClick={() => refetch()} className="text-xs text-brand-green underline flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  const { kpis, eggTrend, mortalityTrend, mortalityCauses, feedTrend, batchComparison, revenueTrend, revenueByCustomer, eggCondition } = data;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-brand-green" />
            Analytics
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">{role === 'OWNER' ? 'Production, feed, and revenue trends' : 'Production and feed trends'}</p>
        </div>
        {/* Period filter */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
          {RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                range === r.value
                  ? 'bg-brand-green text-white shadow'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div className={`grid gap-3 ${role === 'OWNER' ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'}`}>
        <KpiCard icon={Egg}          label="Eggs"         value={kpis.totalEggs.toLocaleString()} sub={`${kpis.totalTrays} trays`} />
        <KpiCard icon={TrendingUp}   label="Avg HDP%"     value={`${kpis.avgHdp}%`} color="teal-600" />
        <KpiCard icon={AlertTriangle} label="Mortality"   value={kpis.totalMortality} color="red-500" />
        <KpiCard icon={Wheat}        label="Feed Used"    value={`${kpis.totalFeedKg.toLocaleString()} kg`} color="amber-600" />
        {role === 'OWNER' && (
          <KpiCard icon={DollarSign}  label="Revenue"     value={`KES ${kpis.totalRevenue.toLocaleString()}`} color="blue-600" />
        )}
      </div>

      {/* ── Egg production line chart (AN-01) ──────────────────────────────── */}
      <ChartSection title="Egg Production Trend">
        {eggTrend.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">No approved egg sessions in this period</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={eggTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                labelFormatter={l => `Date: ${l}`}
                formatter={(val: number, name: string) => [val.toLocaleString(), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="eggs"  name="Good Eggs" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="trays" name="Trays"     stroke="#0d9488" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="broken" name="Broken"   stroke="#dc2626" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartSection>

      {/* ── HDP% trend line chart (AN-01) ──────────────────────────────────── */}
      <ChartSection title="Hen Day Production % (HDP) Trend">
        {eggTrend.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">No data</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={eggTrend.filter((d: any) => d.hdp > 0)} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(val: number) => [`${val}%`, 'HDP']} labelFormatter={l => `Date: ${l}`} />
              <Line type="monotone" dataKey="hdp" name="HDP%" stroke="#2563eb" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartSection>

      {/* ── Two-column row: mortality trend + mortality causes pie ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSection title="Mortality Trend">
          {mortalityTrend.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No mortality records in this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={mortalityTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={l => `Date: ${l}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="mortality" name="Deaths"   stroke="#dc2626" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="culling"   name="Cullings" stroke="#d97706" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartSection>

        <ChartSection title="Mortality Cause Breakdown">
          {mortalityCauses.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No mortality data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={mortalityCauses}
                  dataKey="count"
                  nameKey="cause"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ cause, percent }) => `${cause.replace(/_/g, ' ')} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {mortalityCauses.map((_: unknown, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number, name: string) => [val, name.replace(/_/g, ' ')]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartSection>
      </div>

      {/* ── Feed consumption trend (AN-01) ─────────────────────────────────── */}
      <ChartSection title="Feed Consumption Trend (kg/day)">
        {feedTrend.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">No feed logs in this period</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={feedTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={l => `Date: ${l}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="LAYER_MASH"     name="Layer Mash"     fill="#16a34a" stackId="feed" />
              <Bar dataKey="GROWER_MASH"    name="Grower Mash"    fill="#0d9488" stackId="feed" />
              <Bar dataKey="CHICK_MASH"     name="Chick Mash"     fill="#2563eb" stackId="feed" />
              <Bar dataKey="KIENYEJI_STARTER" name="KJ Starter"   fill="#d97706" stackId="feed" />
              <Bar dataKey="KIENYEJI_GROWER"  name="KJ Grower"    fill="#dc2626" stackId="feed" />
              <Bar dataKey="KIENYEJI_FINISHER" name="KJ Finisher" fill="#7c3aed" stackId="feed" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartSection>

      {/* ── Batch comparison bar chart (AN-02) ─────────────────────────────── */}
      <ChartSection title="Batch Comparison — Eggs Produced">
        {batchComparison.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">No active batches</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={batchComparison} layout="vertical" margin={{ top: 5, right: 20, left: 60, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="batchCode" type="category" tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={(val: number, name: string) => [val.toLocaleString(), name]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="totalEggs"  name="Eggs"   fill="#16a34a" radius={[0, 4, 4, 0]} />
              <Bar dataKey="totalTrays" name="Trays"  fill="#0d9488" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartSection>

      {/* ── Two-column row: revenue trend + revenue by customer ──────────── */}
      {role === 'OWNER' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartSection title="Revenue Trend (KES)">
            {revenueTrend.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">No payments in this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revenueTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip labelFormatter={l => `Date: ${l}`} formatter={(v: number) => [`KES ${v.toLocaleString()}`, 'Revenue']} />
                  <Bar dataKey="amount" name="Revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartSection>

          <ChartSection title="Revenue by Customer (Top 10)">
            {revenueByCustomer.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">No revenue data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={revenueByCustomer}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => percent > 0.05 ? `${name.split(' ')[0]} ${(percent*100).toFixed(0)}%` : ''}
                    labelLine={false}
                  >
                    {revenueByCustomer.map((_: unknown, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: number, name: string) => [`KES ${val.toLocaleString()}`, name]} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartSection>

          {/* ── AN-07: Predictive Sales Projection ──────────────────────── */}
          <ChartSection title="Sales Projection — 14-Day Forecast">
            {!projData ? (
              <p className="text-xs text-gray-400 text-center py-8">Loading projection…</p>
            ) : (
              <>
                {/* Summary pills */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full">
                    Avg daily: KES {projData.summary.avgDailyRevenue.toLocaleString()}
                  </span>
                  <span className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-3 py-1 rounded-full">
                    14-day forecast: KES {projData.summary.projectedRevenue14d.toLocaleString()}
                  </span>
                  <span className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full">
                    Booking pipeline: KES {projData.summary.pendingBookingsPipeline.toLocaleString()}
                  </span>
                  <span className={`text-xs px-3 py-1 rounded-full ${
                    projData.summary.trendDirection === 'up'
                      ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                      : projData.summary.trendDirection === 'down'
                        ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                  }`}>
                    Trend: {projData.summary.trendDirection === 'up' ? '↑ Rising' : projData.summary.trendDirection === 'down' ? '↓ Declining' : '→ Flat'}
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={projData.series} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} interval={3} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      labelFormatter={l => `Date: ${l}`}
                      formatter={(v: number, name: string) => [`KES ${v?.toLocaleString() ?? '—'}`, name]}
                    />
                    <Legend />
                    <ReferenceLine
                      x={dayjs().format('YYYY-MM-DD')}
                      stroke="#9ca3af"
                      strokeDasharray="4 4"
                      label={{ value: 'Today', position: 'top', fontSize: 10, fill: '#9ca3af' }}
                    />
                    <Bar dataKey="actual" name="Actual revenue" fill="#2563eb" radius={[3, 3, 0, 0]} />
                    <Line
                      dataKey="projected"
                      name="Projected revenue"
                      stroke="#16a34a"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 mt-2">
                  Projection blends 30-day revenue trend with confirmed booking pipeline. Dashed line = forecast.
                </p>
              </>
            )}
          </ChartSection>

          {/* Companion card — projection summary stats to balance the 2-col grid */}
          <ChartSection title="Forecast Summary">
            {!projData ? (
              <p className="text-xs text-gray-400 text-center py-8">Loading…</p>
            ) : (
              <div className="space-y-4 py-2">
                {[
                  { label: 'Average Daily Revenue', value: `KES ${projData.summary.avgDailyRevenue.toLocaleString()}`, color: 'text-blue-600' },
                  { label: '14-Day Revenue Forecast', value: `KES ${projData.summary.projectedRevenue14d.toLocaleString()}`, color: 'text-brand-green' },
                  { label: 'Advance Booking Pipeline', value: `KES ${projData.summary.pendingBookingsPipeline.toLocaleString()}`, color: 'text-amber-600' },
                  { label: 'Revenue Trend', value: projData.summary.trendDirection === 'up' ? '↑ Rising' : projData.summary.trendDirection === 'down' ? '↓ Declining' : '→ Flat',
                    color: projData.summary.trendDirection === 'up' ? 'text-green-600' : projData.summary.trendDirection === 'down' ? 'text-red-600' : 'text-gray-500' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-dark-border last:border-0">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
                    <p className={`text-sm font-bold ${color}`}>{value}</p>
                  </div>
                ))}
                <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                  Forecast is based on the last 30 days of actual revenue combined with confirmed advance bookings in the pipeline.
                </p>
              </div>
            )}
          </ChartSection>
        </div>
      )}

      {/* ── Egg condition pie (AN-03) ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSection title="Egg Condition Breakdown">
          {eggCondition.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={eggCondition}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}
                  labelLine={false}
                >
                  <Cell fill="#16a34a" />
                  <Cell fill="#dc2626" />
                </Pie>
                <Tooltip formatter={(val: number, name: string) => [val.toLocaleString(), name]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartSection>

        {/* ── FCR Scatter — feed vs eggs per batch (AN-04) ──────────────── */}
        <ChartSection title="FCR Analysis — Feed vs Eggs by Batch">
          {batchComparison.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No batch data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="totalFeedKg"  name="Feed (kg)"  tick={{ fontSize: 11 }} label={{ value: 'Feed (kg)', position: 'insideBottom', offset: -5, fontSize: 11 }} />
                <YAxis dataKey="totalEggs"    name="Eggs"       tick={{ fontSize: 11 }} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-xs">
                        <p className="font-semibold">{d.batchCode}</p>
                        <p>Feed: {d.totalFeedKg.toLocaleString()} kg</p>
                        <p>Eggs: {d.totalEggs.toLocaleString()}</p>
                        <p>FCR: {d.totalEggs > 0 ? (d.totalFeedKg / d.totalEggs).toFixed(3) : '—'}</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={batchComparison} fill="#16a34a" />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </ChartSection>
      </div>

      {/* ── Egg count histogram (AN-05) ────────────────────────────────────── */}
      <ChartSection title="Daily Egg Count Distribution">
        {eggTrend.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">No data</p>
        ) : (() => {
          // Build histogram buckets
          const vals = eggTrend.map((d: any) => d.eggs).filter((v: number) => v > 0);
          if (vals.length === 0) return <p className="text-xs text-gray-400 text-center py-8">No data</p>;
          const min = Math.min(...vals);
          const max = Math.max(...vals);
          const bucketCount = Math.min(10, vals.length);
          const step = Math.ceil((max - min) / bucketCount) || 1;
          const buckets: { range: string; count: number }[] = [];
          for (let i = 0; i < bucketCount; i++) {
            const lo = min + i * step;
            const hi = lo + step;
            buckets.push({ range: `${lo.toLocaleString()}`, count: vals.filter((v: number) => v >= lo && v < hi).length });
          }
          return (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={buckets} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(val: number) => [val, 'Days']} labelFormatter={l => `≥ ${l} eggs`} />
                <Bar dataKey="count" name="Days" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          );
        })()}
      </ChartSection>
    </div>
  );
}
