import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import dayjs from 'dayjs';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, ScatterChart, Scatter,
  ComposedChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  TrendingUp, Egg, AlertTriangle, Wheat, DollarSign,
  RefreshCw, Activity, BarChart2, Target,
} from 'lucide-react';

// ── Chart colours (work on dark and light backgrounds) ───────────────────────
const C = {
  green:  '#22c55e',
  teal:   '#2dd4bf',
  blue:   '#60a5fa',
  amber:  '#fbbf24',
  red:    '#f87171',
  purple: '#a78bfa',
  cyan:   '#22d3ee',
  pink:   '#f472b6',
};
const CHART_COLORS = [C.green, C.teal, C.blue, C.amber, C.red, C.purple, C.cyan, C.pink];

const RANGES = [
  { label: 'Today',   value: 'today' },
  { label: '7 Days',  value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
];

interface Props { role: 'OWNER' | 'MANAGER' }

// ── Recharts axis tick — light on dark, dark on light ────────────────────────
const TICK_STYLE = { fontSize: 11, fill: '#6b8f74' };

function shortDate(d: string) {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────
function TipBox({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-card border border-dark-border rounded-xl px-3 py-2 text-xs shadow-lg min-w-[120px]">
      {label && <p className="text-dark-muted font-semibold mb-1">{label}</p>}
      {payload.map((e: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.color }} />
          <span className="text-dark-muted">{e.name}:</span>
          <span className="font-semibold text-dark-text">
            {fmt ? fmt(e.value, e.name) : e.value?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, accent, iconBg }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
  accent: string; iconBg: string;
}) {
  return (
    <div className="relative bg-dark-card border border-dark-border rounded-2xl p-4 overflow-hidden">
      {/* left accent stripe */}
      <div className="absolute inset-y-0 left-0 w-1 rounded-l-2xl" style={{ background: accent }} />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-widest uppercase text-dark-muted mb-1.5">{label}</p>
          <p className="text-2xl font-extrabold text-dark-text leading-none truncate">{value}</p>
          {sub && <p className="text-[11px] text-dark-muted mt-1">{sub}</p>}
        </div>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ml-2" style={{ background: iconBg }}>
          <Icon className="w-4 h-4" style={{ color: accent }} />
        </div>
      </div>
    </div>
  );
}

// ── Section card ─────────────────────────────────────────────────────────────
function Card({ title, sub, children, action }: {
  title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-dark-text">{title}</h3>
          {sub && <p className="text-[11px] text-dark-muted mt-0.5">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Mini progress bar ─────────────────────────────────────────────────────────
function Bar2({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 bg-dark-border rounded-full overflow-hidden w-full">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

// ── Legend strip ──────────────────────────────────────────────────────────────
function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 mt-2">
      {items.map(l => (
        <span key={l.label} className="flex items-center gap-1.5 text-[11px] text-dark-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
    </div>
  );
}

// ── Pill ───────────────────────────────────────────────────────────────────────
function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full" style={{ color, background: `${color}22` }}>
      {children}
    </span>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function AnalyticsDashboard({ role }: Props) {
  const [range, setRange] = useState('30d');
  const [includeHistory, setIncludeHistory] = useState(false);

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

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <div className="w-8 h-8 rounded-full border-4 border-dark-border border-t-brand-greenDark animate-spin" />
      <p className="text-sm text-dark-muted">Loading analytics…</p>
    </div>
  );

  if (isError || !data) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <div className="w-12 h-12 rounded-2xl bg-red-900/30 flex items-center justify-center">
        <AlertTriangle className="w-6 h-6 text-red-400" />
      </div>
      <p className="text-sm font-semibold text-dark-text">Failed to load analytics</p>
      <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-brand-greenDark bg-brand-lightDark px-3 py-1.5 rounded-lg border border-dark-border">
        <RefreshCw className="w-3 h-3" /> Retry
      </button>
    </div>
  );

  const {
    kpis, eggTrend, mortalityTrend, mortalityCauses,
    feedTrend, batchComparison, revenueTrend, revenueByCustomer, eggCondition,
  } = data;

  const isDirector = role === 'OWNER';

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-lightDark flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-brand-greenDark" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-dark-text tracking-tight">Analytics Overview</h1>
            <p className="text-[11px] text-dark-muted">
              {isDirector ? 'Revenue, production & forecast intelligence' : 'Production and feed performance metrics'}
            </p>
          </div>
        </div>

        {/* Period tabs */}
        <div className="flex gap-1 bg-dark-bg p-1 rounded-xl border border-dark-border overflow-x-auto w-full sm:w-auto">
          {RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                range === r.value
                  ? 'bg-brand-green text-white shadow'
                  : 'text-dark-muted hover:text-dark-text hover:bg-dark-card'
              }`}
            >{r.label}</button>
          ))}
        </div>
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────────── */}
      <div className={`grid gap-3 grid-cols-1 sm:grid-cols-2 ${isDirector ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
        <KpiCard icon={Egg}           label="Total Eggs" value={kpis.totalEggs.toLocaleString()} sub={`${kpis.totalTrays} trays`}     accent={C.green}  iconBg={`${C.green}22`} />
        <KpiCard icon={Activity}      label="Avg HDP %"  value={`${kpis.avgHdp}%`}               accent={C.teal}   iconBg={`${C.teal}22`} />
        <KpiCard icon={AlertTriangle} label="Mortality"  value={kpis.totalMortality}             accent={C.red}    iconBg={`${C.red}22`} />
        <KpiCard icon={Wheat}         label="Feed Used"  value={`${kpis.totalFeedKg.toLocaleString()} kg`} accent={C.amber} iconBg={`${C.amber}22`} />
        {isDirector && (
          <KpiCard icon={DollarSign}  label="Revenue"    value={`KES ${kpis.totalRevenue.toLocaleString()}`} accent={C.blue} iconBg={`${C.blue}22`} />
        )}
      </div>

      {/* ── Egg Production + HDP ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card title="Egg Production" sub="Daily good eggs, trays & breakage">
            {eggTrend.length === 0 ? (
              <p className="text-xs text-dark-muted text-center py-8">No approved egg sessions in this period</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={eggTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="eggGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.green} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                    <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} />
                    <Tooltip content={<TipBox fmt={(v: number) => v.toLocaleString()} />} />
                    <Area type="monotone" dataKey="eggs"   name="Good Eggs" stroke={C.green} strokeWidth={2.5} fill="url(#eggGrad)" dot={false} />
                    <Line  type="monotone" dataKey="trays"  name="Trays"     stroke={C.teal}  strokeWidth={2}   dot={false} />
                    <Line  type="monotone" dataKey="broken" name="Broken"    stroke={C.red}   strokeWidth={1.5} dot={false} strokeDasharray="5 3" />
                  </ComposedChart>
                </ResponsiveContainer>
                <Legend items={[{ label: 'Good Eggs', color: C.green }, { label: 'Trays', color: C.teal }, { label: 'Broken', color: C.red }]} />
              </>
            )}
          </Card>
        </div>

        <Card title="HDP % Trend" sub="Hen Day Production rate">
          {eggTrend.filter((d: any) => d.hdp > 0).length === 0 ? (
            <p className="text-xs text-dark-muted text-center py-8">No data</p>
          ) : (
            <>
              <p className="text-4xl font-black text-brand-greenDark leading-none mb-1">{kpis.avgHdp}%</p>
              <p className="text-[11px] text-dark-muted mb-3">Average over period</p>
              <ResponsiveContainer width="100%" height={155}>
                <LineChart data={eggTrend.filter((d: any) => d.hdp > 0)} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <Tooltip content={<TipBox fmt={(v: number) => `${v}%`} />} />
                  <Line type="monotone" dataKey="hdp" name="HDP%" stroke={C.blue} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </Card>
      </div>

      {/* ── Mortality Trend + Causes ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Mortality Trend" sub="Deaths and cullings over time">
          {mortalityTrend.length === 0 ? (
            <p className="text-xs text-dark-muted text-center py-8">No mortality records in this period</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={mortalityTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barGap={2}>
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <Tooltip content={<TipBox />} />
                  <Bar dataKey="mortality" name="Deaths"   fill={C.red}   radius={[4, 4, 0, 0]} />
                  <Bar dataKey="culling"   name="Cullings" fill={C.amber} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <Legend items={[{ label: 'Deaths', color: C.red }, { label: 'Cullings', color: C.amber }]} />
            </>
          )}
        </Card>

        <Card title="Mortality Causes" sub="Breakdown by cause">
          {mortalityCauses.length === 0 ? (
            <p className="text-xs text-dark-muted text-center py-8">No mortality data</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={mortalityCauses} dataKey="count" nameKey="cause"
                    cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                    paddingAngle={3} startAngle={90} endAngle={-270}>
                    {mortalityCauses.map((_: unknown, i: number) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: number, name: string) => [val, (name as string).replace(/_/g, ' ')]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2.5 min-w-0">
                {mortalityCauses.slice(0, 5).map((c: any, i: number) => {
                  const total = mortalityCauses.reduce((s: number, x: any) => s + x.count, 0);
                  const pct = total > 0 ? (c.count / total) * 100 : 0;
                  return (
                    <div key={i}>
                      <div className="flex justify-between mb-1 gap-2">
                        <span className="text-[11px] text-dark-muted truncate">{c.cause.replace(/_/g, ' ')}</span>
                        <span className="text-[11px] font-bold text-dark-text flex-shrink-0">{c.count}</span>
                      </div>
                      <Bar2 pct={pct} color={CHART_COLORS[i % CHART_COLORS.length]} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Feed Consumption ─────────────────────────────────────────────── */}
      <Card title="Feed Consumption" sub="Daily kg by feed type (stacked)">
        {feedTrend.length === 0 ? (
          <p className="text-xs text-dark-muted text-center py-8">No feed logs in this period</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={feedTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <Tooltip content={<TipBox />} />
                <Bar dataKey="LAYER_MASH"        name="Layer Mash"    fill={C.green}  stackId="f" />
                <Bar dataKey="GROWER_MASH"       name="Grower Mash"   fill={C.teal}   stackId="f" />
                <Bar dataKey="CHICK_MASH"        name="Chick Mash"    fill={C.blue}   stackId="f" />
                <Bar dataKey="KIENYEJI_STARTER"  name="KJ Starter"    fill={C.amber}  stackId="f" />
                <Bar dataKey="KIENYEJI_GROWER"   name="KJ Grower"     fill={C.red}    stackId="f" />
                <Bar dataKey="KIENYEJI_FINISHER" name="KJ Finisher"   fill={C.purple} stackId="f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <Legend items={[
              { label: 'Layer Mash', color: C.green }, { label: 'Grower Mash', color: C.teal },
              { label: 'Chick Mash', color: C.blue },  { label: 'KJ Starter',  color: C.amber },
              { label: 'KJ Grower',  color: C.red },   { label: 'KJ Finisher', color: C.purple },
            ]} />
          </>
        )}
      </Card>

      {/* ── Batch Comparison ─────────────────────────────────────────────── */}
      <Card
        title="Batch Performance"
        sub="Eggs produced per batch"
        action={
          <label className="flex items-center gap-1.5 text-[11px] text-dark-muted cursor-pointer">
            <input type="checkbox" checked={includeHistory} onChange={e => setIncludeHistory(e.target.checked)} className="accent-brand-green" />
            Include historical
          </label>
        }
      >
        {batchComparison.length === 0 ? (
          <p className="text-xs text-dark-muted text-center py-8">
            {includeHistory ? 'No batch data' : 'No active batches — enable "Include Historical" to compare past batches'}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, batchComparison.length * 44)}>
            <BarChart data={batchComparison} layout="vertical" margin={{ top: 4, right: 20, left: 64, bottom: 0 }}>
              <XAxis type="number" tick={TICK_STYLE} axisLine={false} tickLine={false} />
              <YAxis dataKey="batchCode" type="category" tick={{ ...TICK_STYLE, fontSize: 12 }} width={60} axisLine={false} tickLine={false} />
              <Tooltip content={<TipBox fmt={(v: number) => v.toLocaleString()} />} />
              <Bar dataKey="totalEggs"  name="Eggs"  fill={C.green}              radius={[0, 6, 6, 0]} />
              <Bar dataKey="totalTrays" name="Trays" fill={C.teal} fillOpacity={0.7} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ── Egg Condition + FCR ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Egg Condition" sub="Good vs broken split">
          {eggCondition.length === 0 ? (
            <p className="text-xs text-dark-muted text-center py-8">No data</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={eggCondition} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={45} outerRadius={75}
                    paddingAngle={4} startAngle={90} endAngle={-270}>
                    <Cell fill={C.green} strokeWidth={0} />
                    <Cell fill={C.red}   strokeWidth={0} />
                  </Pie>
                  <Tooltip formatter={(val: number, name: string) => [val.toLocaleString(), name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-3 min-w-0">
                {eggCondition.map((c: any, i: number) => {
                  const total = eggCondition.reduce((s: number, x: any) => s + x.value, 0);
                  const pct = total > 0 ? ((c.value / total) * 100).toFixed(1) : '0';
                  const color = i === 0 ? C.green : C.red;
                  return (
                    <div key={c.name}>
                      <div className="flex justify-between mb-1 gap-2">
                        <span className="text-[11px] text-dark-muted truncate">{c.name}</span>
                        <span className="text-[11px] font-bold flex-shrink-0" style={{ color }}>{pct}%</span>
                      </div>
                      <Bar2 pct={parseFloat(pct)} color={color} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <Card title="FCR Analysis" sub="Feed (kg) vs eggs produced per batch">
          {batchComparison.length === 0 ? (
            <p className="text-xs text-dark-muted text-center py-8">No batch data</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 4, right: 12, left: -16, bottom: 24 }}>
                <XAxis dataKey="totalFeedKg" name="Feed (kg)" tick={TICK_STYLE} axisLine={false} tickLine={false}
                  label={{ value: 'Feed (kg)', position: 'insideBottom', offset: -16, fontSize: 11, fill: '#6b8f74' }} />
                <YAxis dataKey="totalEggs" name="Eggs" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <Tooltip
                  content={({ payload }: any) => {
                    if (!payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-dark-card border border-dark-border rounded-xl px-3 py-2 text-xs shadow-lg">
                        <p className="font-bold text-dark-text mb-1">{d.batchCode}</p>
                        <p className="text-dark-muted">Feed: <span className="text-dark-text font-semibold">{d.totalFeedKg.toLocaleString()} kg</span></p>
                        <p className="text-dark-muted">Eggs: <span className="text-dark-text font-semibold">{d.totalEggs.toLocaleString()}</span></p>
                        <p className="text-dark-muted">FCR: <span className="text-dark-text font-semibold">{d.totalEggs > 0 ? (d.totalFeedKg / d.totalEggs).toFixed(3) : '—'}</span></p>
                      </div>
                    );
                  }}
                />
                <Scatter data={batchComparison} fill={C.green} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* ── Daily Egg Distribution ───────────────────────────────────────── */}
      <Card title="Daily Egg Count Distribution" sub="Frequency of production volumes">
        {eggTrend.length === 0 ? (
          <p className="text-xs text-dark-muted text-center py-8">No data</p>
        ) : (() => {
          const vals = eggTrend.map((d: any) => d.eggs).filter((v: number) => v > 0);
          if (!vals.length) return <p className="text-xs text-dark-muted text-center py-8">No data</p>;
          const min = Math.min(...vals), max = Math.max(...vals);
          const bc = Math.min(10, vals.length);
          const step = Math.ceil((max - min) / bc) || 1;
          const buckets = Array.from({ length: bc }, (_, i) => {
            const lo = min + i * step, hi = lo + step;
            return { range: lo.toLocaleString(), count: vals.filter((v: number) => v >= lo && v < hi).length };
          });
          return (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={buckets} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <XAxis dataKey="range" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <Tooltip formatter={(val: number) => [val, 'Days']} labelFormatter={l => `≥ ${l} eggs`} />
                <Bar dataKey="count" name="Days" radius={[6, 6, 0, 0]}>
                  {buckets.map((_, i) => (
                    <Cell key={i} fill={i % 2 === 0 ? C.green : C.teal} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          );
        })()}
      </Card>

      {/* ── OWNER ONLY: Revenue + Forecast ──────────────────────────────── */}
      {isDirector && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue Trend */}
            <Card title="Revenue Trend" sub="Daily payments received (KES)">
              {revenueTrend.length === 0 ? (
                <p className="text-xs text-dark-muted text-center py-8">No payments in this period</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={revenueTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                    <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TipBox fmt={(v: number) => `KES ${v.toLocaleString()}`} />} />
                    <Bar dataKey="amount" name="Revenue" radius={[6, 6, 0, 0]}>
                      {revenueTrend.map((_: any, i: number) => (
                        <Cell key={i} fill={i === revenueTrend.length - 1 ? C.blue : `${C.blue}99`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Revenue by Customer */}
            <Card title="Revenue by Customer" sub="Top 10 clients by share">
              {revenueByCustomer.length === 0 ? (
                <p className="text-xs text-dark-muted text-center py-8">No revenue data</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={revenueByCustomer} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" innerRadius={42} outerRadius={72}
                        paddingAngle={3} startAngle={90} endAngle={-270}>
                        {revenueByCustomer.map((_: unknown, i: number) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val: number, name: string) => [`KES ${val.toLocaleString()}`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 min-w-0">
                    {revenueByCustomer.slice(0, 6).map((c: any, i: number) => {
                      const total = revenueByCustomer.reduce((s: number, x: any) => s + x.value, 0);
                      const pct = total > 0 ? ((c.value / total) * 100).toFixed(1) : '0';
                      return (
                        <div key={c.name}>
                          <div className="flex justify-between mb-1 gap-2">
                            <span className="text-[10px] text-dark-muted truncate">{c.name}</span>
                            <span className="text-[10px] font-bold flex-shrink-0" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>{pct}%</span>
                          </div>
                          <Bar2 pct={parseFloat(pct)} color={CHART_COLORS[i % CHART_COLORS.length]} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* ── 14-Day Forecast ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Card title="14-Day Sales Forecast" sub="Actual revenue with projected pipeline">
                {!projData ? (
                  <p className="text-xs text-dark-muted text-center py-8">Loading projection…</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <Pill color={C.blue}>Avg daily: KES {projData.summary.avgDailyRevenue.toLocaleString()}</Pill>
                      <Pill color={C.green}>14-day: KES {projData.summary.projectedRevenue14d.toLocaleString()}</Pill>
                      <Pill color={C.amber}>Pipeline: KES {projData.summary.pendingBookingsPipeline.toLocaleString()}</Pill>
                      <Pill color={
                        projData.summary.trendDirection === 'up' ? C.green :
                        projData.summary.trendDirection === 'down' ? C.red : '#94a3b8'
                      }>
                        {projData.summary.trendDirection === 'up' ? '↑ Rising' :
                         projData.summary.trendDirection === 'down' ? '↓ Declining' : '→ Flat'}
                      </Pill>
                    </div>
                    <ResponsiveContainer width="100%" height={230}>
                      <ComposedChart data={projData.series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                        <defs>
                          <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={C.green} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK_STYLE} axisLine={false} tickLine={false} interval={3} />
                        <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                        <Tooltip content={<TipBox fmt={(v: number) => `KES ${v?.toLocaleString() ?? '—'}`} />} />
                        <ReferenceLine x={dayjs().format('YYYY-MM-DD')} stroke="#243329" strokeWidth={1.5}
                          label={{ value: 'Today', position: 'top', fontSize: 10, fill: '#6b8f74' }} />
                        <Bar  dataKey="actual"    name="Actual revenue"    fill={C.blue}  fillOpacity={0.8} radius={[4, 4, 0, 0]} />
                        <Area dataKey="projected" name=""                  stroke="none"  fill="url(#projGrad)" connectNulls={false} />
                        <Line dataKey="projected" name="Projected revenue" stroke={C.green} strokeWidth={2.5} dot={false} connectNulls={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <p className="text-[11px] text-dark-muted mt-2">
                      Forecast blends 30-day revenue trend with confirmed booking pipeline. Green line = projection.
                    </p>
                  </>
                )}
              </Card>
            </div>

            {/* Forecast Summary */}
            <Card title="Forecast Summary" sub="Key projection metrics">
              {!projData ? (
                <p className="text-xs text-dark-muted text-center py-8">Loading…</p>
              ) : (
                <div>
                  {[
                    { label: 'Avg Daily Revenue', value: `KES ${projData.summary.avgDailyRevenue.toLocaleString()}`,          color: C.blue,  icon: DollarSign },
                    { label: '14-Day Forecast',   value: `KES ${projData.summary.projectedRevenue14d.toLocaleString()}`,     color: C.green, icon: TrendingUp },
                    { label: 'Booking Pipeline',  value: `KES ${projData.summary.pendingBookingsPipeline.toLocaleString()}`, color: C.amber, icon: Target },
                    {
                      label: 'Revenue Trend',
                      value: projData.summary.trendDirection === 'up' ? '↑ Rising' : projData.summary.trendDirection === 'down' ? '↓ Declining' : '→ Flat',
                      color: projData.summary.trendDirection === 'up' ? C.green : projData.summary.trendDirection === 'down' ? C.red : '#94a3b8',
                      icon: Activity,
                    },
                  ].map(({ label, value, color, icon: Ic }) => (
                    <div key={label} className="flex items-center justify-between py-3 border-b border-dark-border last:border-0">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}22` }}>
                          <Ic className="w-3.5 h-3.5" style={{ color }} />
                        </div>
                        <p className="text-xs text-dark-muted">{label}</p>
                      </div>
                      <p className="text-xs font-bold" style={{ color }}>{value}</p>
                    </div>
                  ))}
                  <p className="text-[11px] text-dark-muted mt-3 leading-relaxed">
                    Based on 30 days of actual revenue combined with confirmed advance bookings.
                  </p>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
