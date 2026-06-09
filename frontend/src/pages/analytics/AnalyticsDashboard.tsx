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
import { TrendingUp, Egg, AlertTriangle, Wheat, DollarSign, RefreshCw, Activity, BarChart2, Target } from 'lucide-react';

// ── Brand palette ─────────────────────────────────────────────────────────────
const BRAND = {
  green:      '#16a34a',
  greenLight: '#dcfce7',
  greenMid:   '#4ade80',
  teal:       '#0d9488',
  tealLight:  '#ccfbf1',
  blue:       '#2563eb',
  blueLight:  '#dbeafe',
  amber:      '#d97706',
  amberLight: '#fef3c7',
  red:        '#dc2626',
  redLight:   '#fee2e2',
  purple:     '#7c3aed',
  purpleLight:'#ede9fe',
  slate:      '#64748b',
};

const CHART_COLORS = [BRAND.green, BRAND.teal, BRAND.blue, BRAND.amber, BRAND.red, BRAND.purple, '#0891b2', '#be185d'];

const RANGES = [
  { label: 'Today',   value: 'today' },
  { label: '7 Days',  value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
];

interface Props { role: 'OWNER' | 'MANAGER' }

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltipBox({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
      padding: '10px 14px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', minWidth: 120,
    }}>
      {label && <p style={{ color: '#64748b', marginBottom: 6, fontWeight: 600 }}>{label}</p>}
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
          <span style={{ color: '#475569' }}>{entry.name}:</span>
          <span style={{ fontWeight: 600, color: '#1e293b' }}>
            {formatter ? formatter(entry.value, entry.name) : entry.value?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, accentColor, bgColor }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
  accentColor: string; bgColor: string;
}) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: '18px 20px',
      border: '1px solid #f1f5f9', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: 4,
        background: accentColor, borderRadius: '16px 0 0 16px',
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</p>
          <p style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', lineHeight: 1.1 }}>{value}</p>
          {sub && <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</p>}
        </div>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon style={{ width: 20, height: 20, color: accentColor }} />
        </div>
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, subtitle, children, action }: {
  title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div style={{ background: '#fff', borderRadius: 20, padding: '20px 24px', border: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Pill ──────────────────────────────────────────────────────────────────────
function Pill({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: bg, color, display: 'inline-block' }}>
      {children}
    </span>
  );
}

// ── Mini progress bar ─────────────────────────────────────────────────────────
function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 6, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 4 }} />
    </div>
  );
}

// ── Legend row ────────────────────────────────────────────────────────────────
function LegendRow({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
      {items.map(l => (
        <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />{l.label}
        </span>
      ))}
    </div>
  );
}

// ── Axis tick style ───────────────────────────────────────────────────────────
const TICK = { fontSize: 11, fill: '#94a3b8' };

function shortDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Main export ───────────────────────────────────────────────────────────────
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

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          border: `3px solid ${BRAND.greenLight}`, borderTopColor: BRAND.green,
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ fontSize: 13, color: '#94a3b8' }}>Loading analytics…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: 16, background: BRAND.redLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AlertTriangle style={{ width: 24, height: 24, color: BRAND.red }} />
        </div>
        <p style={{ fontSize: 14, color: '#475569', fontWeight: 600 }}>Failed to load analytics</p>
        <button onClick={() => refetch()} style={{ fontSize: 12, color: BRAND.green, background: BRAND.greenLight, border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw style={{ width: 12, height: 12 }} /> Retry
        </button>
      </div>
    );
  }

  const { kpis, eggTrend, mortalityTrend, mortalityCauses, feedTrend, batchComparison, revenueTrend, revenueByCustomer, eggCondition } = data;
  const isDirector = role === 'OWNER';

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1140, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: BRAND.greenLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BarChart2 style={{ width: 18, height: 18, color: BRAND.green }} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              {isDirector ? 'Director Overview' : 'Production Analytics'}
            </h1>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
              {isDirector ? 'Revenue, production & forecast intelligence' : 'Production and feed performance metrics'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, background: '#f8fafc', padding: 4, borderRadius: 12, border: '1px solid #e2e8f0' }}>
          {RANGES.map(r => (
            <button key={r.value} onClick={() => setRange(r.value)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: range === r.value ? BRAND.green : 'transparent',
              color: range === r.value ? '#fff' : '#64748b',
            }}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isDirector ? 5 : 4}, 1fr)`, gap: 12 }}>
        <KpiCard icon={Egg}           label="Total Eggs" value={kpis.totalEggs.toLocaleString()} sub={`${kpis.totalTrays} trays`} accentColor={BRAND.green}  bgColor={BRAND.greenLight} />
        <KpiCard icon={Activity}      label="Avg HDP %"  value={`${kpis.avgHdp}%`}               accentColor={BRAND.teal}   bgColor={BRAND.tealLight} />
        <KpiCard icon={AlertTriangle} label="Mortality"  value={kpis.totalMortality}             accentColor={BRAND.red}    bgColor={BRAND.redLight} />
        <KpiCard icon={Wheat}         label="Feed Used"  value={`${kpis.totalFeedKg.toLocaleString()} kg`} accentColor={BRAND.amber} bgColor={BRAND.amberLight} />
        {isDirector && (
          <KpiCard icon={DollarSign}  label="Revenue"    value={`KES ${kpis.totalRevenue.toLocaleString()}`} accentColor={BRAND.blue} bgColor={BRAND.blueLight} />
        )}
      </div>

      {/* ── Egg Production + HDP ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <Section title="Egg Production" subtitle="Daily good eggs, trays & breakage">
          {eggTrend.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No approved egg sessions in this period</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={eggTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eggGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BRAND.green} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={BRAND.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltipBox formatter={(v: number) => v.toLocaleString()} />} />
                  <Area type="monotone" dataKey="eggs" name="Good Eggs" stroke={BRAND.green} strokeWidth={2.5} fill="url(#eggGrad)" dot={false} />
                  <Line type="monotone" dataKey="trays" name="Trays" stroke={BRAND.teal} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="broken" name="Broken" stroke={BRAND.red} strokeWidth={1.5} dot={false} strokeDasharray="5 3" />
                </ComposedChart>
              </ResponsiveContainer>
              <LegendRow items={[{ label: 'Good Eggs', color: BRAND.green }, { label: 'Trays', color: BRAND.teal }, { label: 'Broken', color: BRAND.red }]} />
            </>
          )}
        </Section>

        <Section title="HDP % Trend" subtitle="Hen Day Production rate">
          {eggTrend.filter((d: any) => d.hdp > 0).length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No data</p>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 36, fontWeight: 800, color: BRAND.blue, lineHeight: 1, margin: 0 }}>{kpis.avgHdp}%</p>
                <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Average over period</p>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={eggTrend.filter((d: any) => d.hdp > 0)} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={TICK} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltipBox formatter={(v: number) => `${v}%`} />} />
                  <Line type="monotone" dataKey="hdp" name="HDP%" stroke={BRAND.blue} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </Section>
      </div>

      {/* ── Mortality + Causes ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Section title="Mortality Trend" subtitle="Deaths and cullings over time">
          {mortalityTrend.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No mortality records</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={mortalityTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barGap={2}>
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltipBox />} />
                  <Bar dataKey="mortality" name="Deaths"   fill={BRAND.red}   radius={[4, 4, 0, 0]} />
                  <Bar dataKey="culling"   name="Cullings" fill={BRAND.amber}  radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <LegendRow items={[{ label: 'Deaths', color: BRAND.red }, { label: 'Cullings', color: BRAND.amber }]} />
            </>
          )}
        </Section>

        <Section title="Mortality Causes" subtitle="Breakdown by cause">
          {mortalityCauses.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No mortality data</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={mortalityCauses} dataKey="count" nameKey="cause" cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80} paddingAngle={3} startAngle={90} endAngle={-270}>
                    {mortalityCauses.map((_: unknown, i: number) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: number, name: string) => [val, (name as string).replace(/_/g, ' ')]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {mortalityCauses.slice(0, 5).map((c: any, i: number) => {
                  const total = mortalityCauses.reduce((s: number, x: any) => s + x.count, 0);
                  const pct = total > 0 ? (c.count / total) * 100 : 0;
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#475569' }}>{c.cause.replace(/_/g, ' ')}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a' }}>{c.count}</span>
                      </div>
                      <MiniBar pct={pct} color={CHART_COLORS[i % CHART_COLORS.length]} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* ── Feed Consumption ───────────────────────────────────────────────── */}
      <Section title="Feed Consumption" subtitle="Daily kg by feed type (stacked)">
        {feedTrend.length === 0 ? (
          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No feed logs in this period</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={feedTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} axisLine={false} tickLine={false} />
                <YAxis tick={TICK} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltipBox />} />
                <Bar dataKey="LAYER_MASH"        name="Layer Mash"    fill={BRAND.green}  stackId="f" />
                <Bar dataKey="GROWER_MASH"       name="Grower Mash"   fill={BRAND.teal}   stackId="f" />
                <Bar dataKey="CHICK_MASH"        name="Chick Mash"    fill={BRAND.blue}   stackId="f" />
                <Bar dataKey="KIENYEJI_STARTER"  name="KJ Starter"    fill={BRAND.amber}  stackId="f" />
                <Bar dataKey="KIENYEJI_GROWER"   name="KJ Grower"     fill={BRAND.red}    stackId="f" />
                <Bar dataKey="KIENYEJI_FINISHER" name="KJ Finisher"   fill={BRAND.purple} stackId="f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <LegendRow items={[
              { label: 'Layer Mash', color: BRAND.green }, { label: 'Grower Mash', color: BRAND.teal },
              { label: 'Chick Mash', color: BRAND.blue },  { label: 'KJ Starter', color: BRAND.amber },
              { label: 'KJ Grower', color: BRAND.red },    { label: 'KJ Finisher', color: BRAND.purple },
            ]} />
          </>
        )}
      </Section>

      {/* ── Batch Comparison ──────────────────────────────────────────────── */}
      <Section
        title="Batch Performance"
        subtitle="Eggs produced per active batch"
        action={
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b', cursor: 'pointer' }}>
            <input type="checkbox" checked={includeHistory} onChange={e => setIncludeHistory(e.target.checked)} style={{ accentColor: BRAND.green }} />
            Include historical
          </label>
        }
      >
        {batchComparison.length === 0 ? (
          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>
            {includeHistory ? 'No batch data' : 'No active batches — enable "Include Historical Batches" to compare past batches'}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, batchComparison.length * 44)}>
            <BarChart data={batchComparison} layout="vertical" margin={{ top: 4, right: 20, left: 64, bottom: 0 }} barGap={4}>
              <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis dataKey="batchCode" type="category" tick={{ ...TICK, fontSize: 12 }} width={60} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltipBox formatter={(v: number) => v.toLocaleString()} />} />
              <Bar dataKey="totalEggs"  name="Eggs"  fill={BRAND.green} radius={[0, 6, 6, 0]} />
              <Bar dataKey="totalTrays" name="Trays" fill={BRAND.tealLight} stroke={BRAND.teal} strokeWidth={1} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Section>

      {/* ── Egg Condition + FCR ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Section title="Egg Condition" subtitle="Good vs broken split">
          {eggCondition.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No data</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={eggCondition} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={45} outerRadius={75} paddingAngle={4} startAngle={90} endAngle={-270}>
                    <Cell fill={BRAND.green} strokeWidth={0} />
                    <Cell fill={BRAND.red}   strokeWidth={0} />
                  </Pie>
                  <Tooltip formatter={(val: number, name: string) => [val.toLocaleString(), name]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {eggCondition.map((c: any, i: number) => {
                  const total = eggCondition.reduce((s: number, x: any) => s + x.value, 0);
                  const pct = total > 0 ? ((c.value / total) * 100).toFixed(1) : '0';
                  const color = i === 0 ? BRAND.green : BRAND.red;
                  return (
                    <div key={c.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 12, color: '#475569' }}>{c.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
                      </div>
                      <MiniBar pct={parseFloat(pct)} color={color} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>

        <Section title="FCR Analysis" subtitle="Feed (kg) vs eggs per batch">
          {batchComparison.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No batch data</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 4, right: 12, left: -16, bottom: 20 }}>
                <XAxis dataKey="totalFeedKg" name="Feed (kg)" tick={TICK} axisLine={false} tickLine={false}
                  label={{ value: 'Feed (kg)', position: 'insideBottom', offset: -12, fontSize: 11, fill: '#94a3b8' }} />
                <YAxis dataKey="totalEggs" name="Eggs" tick={TICK} axisLine={false} tickLine={false} />
                <Tooltip
                  content={({ payload }: any) => {
                    if (!payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 12 }}>
                        <p style={{ fontWeight: 700, marginBottom: 4 }}>{d.batchCode}</p>
                        <p style={{ color: '#64748b' }}>Feed: <b>{d.totalFeedKg.toLocaleString()} kg</b></p>
                        <p style={{ color: '#64748b' }}>Eggs: <b>{d.totalEggs.toLocaleString()}</b></p>
                        <p style={{ color: '#64748b' }}>FCR: <b>{d.totalEggs > 0 ? (d.totalFeedKg / d.totalEggs).toFixed(3) : '—'}</b></p>
                      </div>
                    );
                  }}
                />
                <Scatter data={batchComparison} fill={BRAND.green} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      {/* ── Histogram ─────────────────────────────────────────────────────── */}
      <Section title="Daily Egg Count Distribution" subtitle="Frequency of production volumes">
        {eggTrend.length === 0 ? (
          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No data</p>
        ) : (() => {
          const vals = eggTrend.map((d: any) => d.eggs).filter((v: number) => v > 0);
          if (!vals.length) return <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No data</p>;
          const min = Math.min(...vals), max = Math.max(...vals);
          const bucketCount = Math.min(10, vals.length);
          const step = Math.ceil((max - min) / bucketCount) || 1;
          const buckets = Array.from({ length: bucketCount }, (_, i) => {
            const lo = min + i * step, hi = lo + step;
            return { range: lo.toLocaleString(), count: vals.filter((v: number) => v >= lo && v < hi).length };
          });
          return (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={buckets} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <XAxis dataKey="range" tick={TICK} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} />
                <Tooltip formatter={(val: number) => [val, 'Days']} labelFormatter={l => `≥ ${l} eggs`} />
                <Bar dataKey="count" name="Days" radius={[6, 6, 0, 0]}>
                  {buckets.map((_, i) => (
                    <Cell key={i} fill={i % 2 === 0 ? BRAND.green : BRAND.greenMid} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          );
        })()}
      </Section>

      {/* ── DIRECTOR ONLY: Revenue & Forecast ─────────────────────────────── */}
      {isDirector && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Section title="Revenue Trend" subtitle="Daily payments received (KES)">
              {revenueTrend.length === 0 ? (
                <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No payments in this period</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={revenueTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} axisLine={false} tickLine={false} />
                    <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltipBox formatter={(v: number) => `KES ${v.toLocaleString()}`} />} />
                    <Bar dataKey="amount" name="Revenue" radius={[6, 6, 0, 0]}>
                      {revenueTrend.map((_: any, i: number) => (
                        <Cell key={i} fill={i === revenueTrend.length - 1 ? BRAND.blue : `${BRAND.blue}99`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Section>

            <Section title="Revenue by Customer" subtitle="Top 10 clients by share">
              {revenueByCustomer.length === 0 ? (
                <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>No revenue data</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {revenueByCustomer.slice(0, 6).map((c: any, i: number) => {
                      const total = revenueByCustomer.reduce((s: number, x: any) => s + x.value, 0);
                      const pct = total > 0 ? ((c.value / total) * 100).toFixed(1) : '0';
                      return (
                        <div key={c.name}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 10, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{c.name}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: CHART_COLORS[i % CHART_COLORS.length] }}>{pct}%</span>
                          </div>
                          <MiniBar pct={parseFloat(pct)} color={CHART_COLORS[i % CHART_COLORS.length]} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Section>
          </div>

          {/* ── 14-Day Forecast ─────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <Section title="14-Day Sales Forecast" subtitle="Actual revenue with projected pipeline">
              {!projData ? (
                <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>Loading projection…</p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    <Pill color={BRAND.blue}  bg={BRAND.blueLight}>Avg daily: KES {projData.summary.avgDailyRevenue.toLocaleString()}</Pill>
                    <Pill color={BRAND.green} bg={BRAND.greenLight}>14-day: KES {projData.summary.projectedRevenue14d.toLocaleString()}</Pill>
                    <Pill color={BRAND.amber} bg={BRAND.amberLight}>Pipeline: KES {projData.summary.pendingBookingsPipeline.toLocaleString()}</Pill>
                    <Pill
                      color={projData.summary.trendDirection === 'up' ? BRAND.green : projData.summary.trendDirection === 'down' ? BRAND.red : BRAND.slate}
                      bg={projData.summary.trendDirection === 'up' ? BRAND.greenLight : projData.summary.trendDirection === 'down' ? BRAND.redLight : '#f1f5f9'}
                    >
                      {projData.summary.trendDirection === 'up' ? '↑ Rising' : projData.summary.trendDirection === 'down' ? '↓ Declining' : '→ Flat'}
                    </Pill>
                  </div>
                  <ResponsiveContainer width="100%" height={230}>
                    <ComposedChart data={projData.series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={BRAND.green} stopOpacity={0.15} />
                          <stop offset="100%" stopColor={BRAND.green} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} axisLine={false} tickLine={false} interval={3} />
                      <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                      <Tooltip content={<CustomTooltipBox formatter={(v: number) => `KES ${v?.toLocaleString() ?? '—'}`} />} />
                      <ReferenceLine x={dayjs().format('YYYY-MM-DD')} stroke="#cbd5e1" strokeWidth={1.5}
                        label={{ value: 'Today', position: 'top', fontSize: 10, fill: '#94a3b8' }} />
                      <Bar dataKey="actual" name="Actual revenue" fill={BRAND.blue} fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                      <Area dataKey="projected" name="" stroke="none" fill="url(#projGrad)" connectNulls={false} />
                      <Line dataKey="projected" name="Projected revenue" stroke={BRAND.green} strokeWidth={2.5} dot={false} connectNulls={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                    Forecast blends 30-day revenue trend with confirmed booking pipeline. Green = projection.
                  </p>
                </>
              )}
            </Section>

            <Section title="Forecast Summary" subtitle="Key projection metrics">
              {!projData ? (
                <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '32px 0' }}>Loading…</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {[
                    { label: 'Avg Daily Revenue', value: `KES ${projData.summary.avgDailyRevenue.toLocaleString()}`, color: BRAND.blue, bg: BRAND.blueLight, icon: DollarSign },
                    { label: '14-Day Forecast',   value: `KES ${projData.summary.projectedRevenue14d.toLocaleString()}`, color: BRAND.green, bg: BRAND.greenLight, icon: TrendingUp },
                    { label: 'Booking Pipeline',  value: `KES ${projData.summary.pendingBookingsPipeline.toLocaleString()}`, color: BRAND.amber, bg: BRAND.amberLight, icon: Target },
                    {
                      label: 'Revenue Trend',
                      value: projData.summary.trendDirection === 'up' ? '↑ Rising' : projData.summary.trendDirection === 'down' ? '↓ Declining' : '→ Flat',
                      color: projData.summary.trendDirection === 'up' ? BRAND.green : projData.summary.trendDirection === 'down' ? BRAND.red : BRAND.slate,
                      bg: projData.summary.trendDirection === 'up' ? BRAND.greenLight : projData.summary.trendDirection === 'down' ? BRAND.redLight : '#f1f5f9',
                      icon: Activity,
                    },
                  ].map(({ label, value, color, bg, icon: Ic }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Ic style={{ width: 14, height: 14, color }} />
                        </div>
                        <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>{label}</p>
                      </div>
                      <p style={{ fontSize: 13, fontWeight: 700, color, margin: 0 }}>{value}</p>
                    </div>
                  ))}
                  <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 12, lineHeight: 1.6 }}>
                    Based on 30 days of actual revenue combined with confirmed advance bookings.
                  </p>
                </div>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
