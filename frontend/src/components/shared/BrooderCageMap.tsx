// src/components/shared/BrooderCageMap.tsx
// Live Brooder Cage Map — represents brooder as a single unit
// Used by MANAGER (ManagerHome) and OWNER/DIRECTOR (OwnerHome)

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { Flame, Bird, Syringe, Thermometer, Droplets, Sun, AlertTriangle, Wheat } from 'lucide-react';
import dayjs from 'dayjs';

interface BrooderBatch {
  id: string;
  batchCode: string;
  currentBirdCount: number;
  quantityReceived: number;
  dateOfHatch: string;
  stage: string;
  location: string;
  isActive: boolean;
  supplier?: { name: string };
  supplierName?: string;
}

interface BrooderLog {
  id: string;
  batchId: string;
  logDate: string;
  waterConsumptionL?: number;
  feedConsumedKg?: number;
  feedType?: string;
  temperature?: number;
  lightingOk: boolean;
  mortalityCount: number;
  vaccineGiven?: string;
  supplement?: string;
}


const FEED_LABELS: Record<string, string> = {
  CHICK_MASH:  'Chick Mash',
  GROWER_MASH: "Grower's Mash",
  LAYER_MASH:  "Layer's Mash",
};
function InfoTile({
  icon: Icon,
  label,
  value,
  accent = 'text-gray-800 dark:text-gray-100',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="bg-white/5 rounded-xl p-3 flex items-start gap-2">
      <Icon className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-white/50 uppercase tracking-wider">{label}</p>
        <p className={`text-sm font-semibold mt-0.5 ${accent} truncate`}>{value}</p>
      </div>
    </div>
  );
}

function BatchCard({ batch }: { batch: BrooderBatch }) {
  const { data: logs = [] } = useQuery<BrooderLog[]>({
    queryKey: ['brooder-logs', batch.id, 'latest'],
    queryFn: () =>
      api.get(`/flock/brooder-logs?batchId=${batch.id}&limit=1`).then(r => r.data).catch(() => []),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const latest: BrooderLog | undefined = logs[0];

  const ageDays = batch.dateOfHatch
    ? dayjs().diff(dayjs(batch.dateOfHatch), 'day')
    : null;
  const ageWeeks = ageDays != null ? Math.floor(ageDays / 7) : null;
  const ageDisplay =
    ageDays != null
      ? `${ageDays}d (${ageWeeks}w)`
      : '—';

  const nearTransfer = ageWeeks != null && ageWeeks >= 16;

  return (
    <div
      className={`rounded-2xl p-4 border ${
        nearTransfer
          ? 'border-amber-500/50 bg-amber-900/20'
          : 'border-white/10 bg-white/5'
      }`}
    >
      {/* Batch header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
            <Flame className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">{batch.batchCode}</p>
            <p className="text-[10px] text-white/50">
              {batch.supplier?.name ?? batch.supplierName ?? 'Unknown supplier'}
            </p>
          </div>
        </div>
        {nearTransfer && (
          <div className="flex items-center gap-1 bg-amber-500/20 border border-amber-500/40 rounded-full px-2 py-0.5">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] text-amber-300 font-semibold">Near Transfer</span>
          </div>
        )}
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-2">
        <InfoTile
          icon={Bird}
          label="Chick Count"
          value={`${(batch.currentBirdCount ?? 0).toLocaleString()} birds`}
          accent="text-green-300"
        />
        <InfoTile
          icon={Flame}
          label="Age"
          value={ageDisplay}
          accent={nearTransfer ? 'text-amber-300' : 'text-white'}
        />
        <InfoTile
          icon={Thermometer}
          label="Last Temp"
          value={latest?.temperature != null ? `${latest.temperature}°C` : '—'}
        />
        <InfoTile
          icon={Droplets}
          label="Water (last log)"
          value={latest?.waterConsumptionL != null ? `${latest.waterConsumptionL}L` : '—'}
        />
        <InfoTile
          icon={Wheat}
          label="Last Feed"
          value={
            latest?.feedType || latest?.feedConsumedKg != null
              ? `${FEED_LABELS[latest?.feedType ?? ''] ?? latest?.feedType ?? 'Fed'}${latest?.feedConsumedKg != null ? ` · ${latest.feedConsumedKg}kg` : ''}`
              : '—'
          }
          accent="text-amber-200"
        />
        <InfoTile
          icon={Sun}
          label="Lighting"
          value={latest ? (latest.lightingOk ? 'Consistent ✓' : 'Issue flagged ⚠') : '—'}
          accent={latest?.lightingOk === false ? 'text-red-400' : 'text-green-300'}
        />
        <InfoTile
          icon={Syringe}
          label="Last Vaccine"
          value={latest?.vaccineGiven ?? 'None logged'}
        />
      </div>

      {/* Last log date */}
      {latest && (
        <p className="text-[10px] text-white/30 mt-3 text-right">
          Last entry: {dayjs(latest.logDate).format('D MMM YYYY')}
        </p>
      )}
    </div>
  );
}

export function BrooderCageMap() {
  const { data: allBatches = [], isLoading } = useQuery<BrooderBatch[]>({
    queryKey: ['batches'],
    queryFn: () => api.get('/flock/batches').then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const brooderBatches = allBatches.filter(
    b => b.location === 'BROODER' && b.isActive
  );

  const totalChicks = brooderBatches.reduce(
    (sum, b) => sum + (b.currentBirdCount ?? 0),
    0
  );

  return (
    <div
      className="rounded-2xl overflow-hidden border border-white/10"
      style={{ background: 'linear-gradient(135deg, #1a0a00 0%, #2d1400 60%, #1a0800 100%)' }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-500/20 border border-amber-500/40 rounded-lg flex items-center justify-center">
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Brooder — Live Overview</p>
            <p className="text-[11px] text-white/40">
              Single-unit monitoring · all chicks tracked as one group
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-amber-400">{totalChicks.toLocaleString()}</p>
          <p className="text-[10px] text-white/40">total chicks</p>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-40 bg-white/5 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : brooderBatches.length === 0 ? (
          <div className="text-center py-10">
            <Flame className="w-10 h-10 text-amber-500/20 mx-auto mb-3" />
            <p className="text-sm text-white/40 font-medium">No active brooder batches</p>
            <p className="text-xs text-white/25 mt-1">
              Assign a batch to the Brooder from the Batches page.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {brooderBatches.map(batch => (
              <BatchCard key={batch.id} batch={batch} />
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-2 border-t border-white/5">
        <p className="text-[10px] text-white/20">
          Auto-refreshes every 2 min · {dayjs().format('HH:mm')}
        </p>
      </div>
    </div>
  );
}
