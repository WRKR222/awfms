// src/pages/attendant/EggCollectionPage.tsx
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, Egg, AlertCircle, WifiOff, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api/client';
import { useOfflineMutation } from '../../hooks/useOfflineSync';
import { useOfflineStore } from '../../stores/offline.store';
import dayjs from 'dayjs';

const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-base bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const numInput = 'w-full text-center border border-gray-200 dark:border-dark-border rounded-lg px-1 py-2 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const cardCls  = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';

function eggsToTrays(eggs: number): string {
  const trays = Math.floor(eggs / 30);
  const remainder = eggs % 30;
  if (trays === 0) return `${remainder} eggs`;
  if (remainder === 0) return `${trays} trays`;
  return `${trays} trays + ${remainder} eggs`;
}

const UNIT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface RowEntry {
  rowCode: string;
  totalBirds: number;
  totalEggs: number;
  emptyBroken: number;  // broken shell, not sellable
  fullBroken: number;   // broken but sellable eggs
  softShell: number;
  deformed: number;
  weightKg: number;
  attendantName: string;
}

type BlockKey = 'BLOCK1' | 'BLOCK2';

function buildDefaultBlock(): { rows: RowEntry[] } {
  const rows: RowEntry[] = [];
  for (const letter of UNIT_LETTERS) {
    for (const rowNum of [1, 2]) {
      rows.push({ rowCode: `${letter}${rowNum}`, totalBirds: 0, totalEggs: 0, emptyBroken: 0, fullBroken: 0, softShell: 0, deformed: 0, weightKg: 0, attendantName: '' });
    }
  }
  return { rows };
}

const defaultShift: 'AM' | 'PM' = dayjs().hour() < 14 ? 'AM' : 'PM';

export function EggCollectionPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: batches = [] } = useQuery({ queryKey: ['batches', 'active'], queryFn: () => api.get('/flock/batches?isActive=true&stage=PRODUCTION').then(r => r.data) });
  const { register, handleSubmit, watch } = useForm({ defaultValues: { shift: defaultShift, openingPop: 0, mortalities: 0, remarks: '', batchId: '' } });
  const { isOnline } = useOfflineStore();
  const [submitted, setSubmitted] = useState(false);
  const [wasQueued, setWasQueued] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<BlockKey | null>(null);
  const [blockData, setBlockData] = useState<Record<BlockKey, { rows: RowEntry[] }>>({ BLOCK1: buildDefaultBlock(), BLOCK2: buildDefaultBlock() });
  const { mutate: offlineMutate } = useOfflineMutation({ endpoint: '/production/sessions', method: 'POST', type: 'production', onSuccess: () => { qc.invalidateQueries({ queryKey: ['production'] }); setSubmitted(true); setWasQueued(false); }, onQueued: () => { setSubmitted(true); setWasQueued(true); } });

  const shift = watch('shift') as 'AM' | 'PM';
  const batchId = watch('batchId');
  const openingPop = Number(watch('openingPop') ?? 0);
  const mortalities = Number(watch('mortalities') ?? 0);
  const closingStock = openingPop - mortalities;
  const allRows = (['BLOCK1', 'BLOCK2'] as BlockKey[]).flatMap(bk => blockData[bk].rows);
  const grandTotalEggs = allRows.reduce((s, r) => s + Number(r.totalEggs ?? 0), 0);
  const grandEmptyBroken = allRows.reduce((s, r) => s + Number(r.emptyBroken ?? 0), 0);
  const grandFullBroken = allRows.reduce((s, r) => s + Number(r.fullBroken ?? 0), 0);
  const grandSoftShell = allRows.reduce((s, r) => s + Number(r.softShell ?? 0), 0);
  const grandDeformed = allRows.reduce((s, r) => s + Number(r.deformed ?? 0), 0);
  const grandWeightKg = allRows.reduce((s, r) => s + Number(r.weightKg ?? 0), 0);
  const hdp = closingStock > 0 ? ((grandTotalEggs / closingStock) * 100).toFixed(1) : '—';
  const selectedBatch = batches.find((b: any) => b.id === batchId);

  function updateRow(block: BlockKey, idx: number, field: keyof RowEntry, value: any) {
    setBlockData(prev => { const rows = [...prev[block].rows]; rows[idx] = { ...rows[idx], [field]: value }; return { ...prev, [block]: { rows } }; });
  }

  function onSubmit(data: any) {
    offlineMutate({ batchId: data.batchId, houseId: selectedBatch?.houseId, sessionDate: dayjs().format('YYYY-MM-DD'), shift: data.shift, openingPop: Number(data.openingPop), mortalities: Number(data.mortalities), rowData: allRows.map(r => ({ rowCode: r.rowCode, totalBirds: Number(r.totalBirds), totalEggs: Number(r.totalEggs), emptyBroken: Number(r.emptyBroken), fullBroken: Number(r.fullBroken), softShell: Number(r.softShell), deformed: Number(r.deformed), weightKg: Number(r.weightKg), attendantName: r.attendantName })), remarks: data.remarks || undefined });
  }

  if (submitted) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center max-w-lg mx-auto mt-20">
        {wasQueued ? (<><WifiOff className="w-16 h-16 text-amber-500 mb-4" /><h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Saved Offline</h2></>) : (<><CheckCircle className="w-16 h-16 text-green-500 mb-4" /><h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{shift} Session Submitted</h2><p className="text-gray-500 dark:text-gray-400 mt-1"><span className="font-bold text-brand-green">{grandTotalEggs} eggs</span>{' · '}{eggsToTrays(grandTotalEggs)} · HDP {hdp}%</p></>)}
        <button onClick={() => navigate('/attendant')} className="mt-6 bg-brand-green text-white rounded-xl px-8 py-3 font-semibold">Back to Home</button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto pb-10">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate('/attendant')} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card transition-colors"><ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" /></button>
        <div><h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2"><Egg className="w-5 h-5 text-amber-500" /> Egg Collection</h1><p className="text-sm text-gray-500 dark:text-gray-400">{dayjs().format('dddd, D MMMM YYYY')}</p></div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={cardCls}>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Batch *</label>
            <select {...register('batchId', { required: true })} className={inputCls}>
              <option value="">Select batch...</option>
              {batches.filter((b: any) => b.stage === 'PRODUCTION').map((b: any) => <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>)}
            </select>
          </div>
          <div className={cardCls}>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Collection Session *</label>
            <div className="flex gap-3">
              {(['AM', 'PM'] as const).map(val => (
                <label key={val} className="flex-1">
                  <input type="radio" {...register('shift')} value={val} className="sr-only" />
                  <div className={`text-center py-3 rounded-xl border-2 cursor-pointer font-semibold transition-colors ${shift === val ? 'border-brand-green bg-brand-green/10 text-brand-green' : 'border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400'}`}>
                    <div className="font-bold text-lg">{val}</div>
                    <div className="text-xs opacity-70">{val === 'AM' ? 'Morning' : 'Afternoon'}</div>
                  </div>
                </label>
              ))}
            </div>
            {shift === 'PM' && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> PM submission triggers official tally.</p>}
          </div>
        </div>

        <div className={cardCls}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Bird Population</p>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-xs text-gray-500 mb-1">Opening Count</label><input {...register('openingPop')} type="number" min="0" inputMode="numeric" className={inputCls} /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Mortalities</label><input {...register('mortalities')} type="number" min="0" inputMode="numeric" className={inputCls} /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Closing Stock (Auto)</label><div className={`${inputCls} bg-brand-green/10 text-brand-green font-bold text-center text-lg`}>{closingStock}</div></div>
          </div>
        </div>

        <div className={cardCls}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Select Block</p>
          <div className="grid grid-cols-2 gap-3">
            {(['BLOCK1', 'BLOCK2'] as BlockKey[]).map(bk => {
              const blockEggs = blockData[bk].rows.reduce((s, r) => s + Number(r.totalEggs ?? 0), 0);
              const isSelected = selectedBlock === bk;
              return (
                <button key={bk} type="button" onClick={() => setSelectedBlock(isSelected ? null : bk)} className={`flex items-center justify-between rounded-xl p-4 border-2 transition-all ${isSelected ? 'border-brand-green bg-brand-green/10' : 'border-gray-200 dark:border-dark-border hover:border-gray-300'}`}>
                  <div className="text-left"><p className={`font-bold text-base ${isSelected ? 'text-brand-green' : 'text-gray-800 dark:text-gray-100'}`}>{bk === 'BLOCK1' ? 'Block 1' : 'Block 2'}</p><p className="text-xs text-gray-500 mt-0.5">Units A – F</p></div>
                  <div className="flex items-center gap-2">{blockEggs > 0 && <span className="text-xs font-semibold text-brand-green bg-brand-green/10 px-2 py-0.5 rounded-full">{blockEggs} eggs</span>}<ChevronDown className={`w-4 h-4 transition-transform ${isSelected ? 'rotate-180 text-brand-green' : 'text-gray-400'}`} /></div>
                </button>
              );
            })}
          </div>
        </div>

        {selectedBlock && (
          <div className={cardCls}>
            <p className="font-bold text-gray-800 dark:text-gray-100 mb-4">{selectedBlock === 'BLOCK1' ? 'Block 1' : 'Block 2'} — Units A to F</p>
            {UNIT_LETTERS.map(letter => {
              const rowIdxOffset = UNIT_LETTERS.indexOf(letter) * 2;
              const row1 = blockData[selectedBlock].rows[rowIdxOffset];
              const row2 = blockData[selectedBlock].rows[rowIdxOffset + 1];
              const unitEggs = Number(row1?.totalEggs ?? 0) + Number(row2?.totalEggs ?? 0);
              return (
                <div key={letter} className="mb-5 pb-4 border-b border-gray-100 dark:border-dark-border last:border-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-sm text-gray-700 dark:text-gray-300">Unit {letter}</p>
                    {unitEggs > 0 && <span className="text-xs text-brand-green bg-brand-green/10 px-2 py-0.5 rounded-full font-medium">{unitEggs} eggs · {eggsToTrays(unitEggs)}</span>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[500px]">
                      <thead>
                        <tr>
                          {['Row', 'Total Birds', 'Total Eggs', 'Empty Broken', 'Full Broken', 'Soft Shell', 'Deformed', 'kg', 'Attendant'].map(h => (
                            <th key={h} className="text-center text-gray-400 font-medium pb-1.5 px-1">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[0, 1].map(offset => {
                          const rowIdx = rowIdxOffset + offset;
                          const row = blockData[selectedBlock].rows[rowIdx];
                          return (
                            <tr key={row.rowCode}>
                              <td className="px-1 py-1"><div className="flex items-center justify-center"><span className="text-xs font-bold text-brand-green bg-brand-green/10 rounded-lg px-2 py-1">{row.rowCode}</span></div></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.totalBirds || ''} onChange={e => updateRow(selectedBlock, rowIdx, 'totalBirds', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.totalEggs || ''} onChange={e => updateRow(selectedBlock, rowIdx, 'totalEggs', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.emptyBroken || ''} onChange={e => updateRow(selectedBlock, rowIdx, 'emptyBroken', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.fullBroken || ''} onChange={e => updateRow(selectedBlock, rowIdx, 'fullBroken', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.softShell || ''} onChange={e => updateRow(selectedBlock, rowIdx, 'softShell', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.deformed || ''} onChange={e => updateRow(selectedBlock, rowIdx, 'deformed', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" step="0.1" inputMode="decimal" value={row.weightKg || ''} onChange={e => updateRow(selectedBlock, rowIdx, 'weightKg', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="text" value={row.attendantName} onChange={e => updateRow(selectedBlock, rowIdx, 'attendantName', e.target.value)} placeholder="Name" className={`${numInput} text-left px-2`} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className={cardCls}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Grand Totals</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[{ label: 'Total Eggs', value: grandTotalEggs.toLocaleString(), accent: 'text-brand-green' }, { label: 'Trays', value: eggsToTrays(grandTotalEggs), accent: 'text-brand-green' }, { label: 'HDP %', value: `${hdp}%`, accent: 'text-amber-600' }, { label: 'Weight (kg)', value: grandWeightKg.toFixed(1), accent: 'text-gray-700 dark:text-gray-200' }].map(({ label, value, accent }) => (
              <div key={label} className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-center"><p className="text-xs text-gray-500">{label}</p><p className={`text-xl font-bold mt-0.5 ${accent}`}>{value}</p></div>
            ))}
          </div>
          {(grandEmptyBroken > 0 || grandFullBroken > 0 || grandSoftShell > 0 || grandDeformed > 0) && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              {[{ label: 'Empty Broken', value: grandEmptyBroken }, { label: 'Full Broken', value: grandFullBroken }, { label: 'Soft Shell', value: grandSoftShell }, { label: 'Deformed', value: grandDeformed }].map(({ label, value }) => (
                <div key={label} className="text-center text-xs"><span className="text-gray-500">{label}: </span><span className="text-red-500 font-semibold">{value}</span></div>
              ))}
            </div>
          )}
        </div>

        <div className={cardCls}>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Remarks</label>
          <textarea {...register('remarks')} rows={2} className={`${inputCls} resize-none`} placeholder="Any additional observations..." />
        </div>

        {!isOnline && (
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-amber-700 dark:text-amber-400 text-sm">
            <WifiOff className="w-4 h-4 shrink-0" /> You're offline. Data will sync when connection is restored.
          </div>
        )}

        <button type="submit" disabled={!batchId} className="w-full bg-brand-green text-white rounded-2xl py-4 text-base font-bold shadow-lg disabled:opacity-60 hover:bg-green-800 transition-colors">
          {isOnline ? `Submit ${shift} Session — ${grandTotalEggs} Eggs (${eggsToTrays(grandTotalEggs)}) →` : `Save Offline — ${grandTotalEggs} Eggs`}
        </button>
      </form>
    </div>
  );
}
