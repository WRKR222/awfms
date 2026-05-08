import React from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useBatches } from '../../hooks/useFlock';
import dayjs from 'dayjs';

const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 text-base bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-yellow-500';
const labelCls = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1';
const cardCls  = 'bg-white dark:bg-dark-card rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100 dark:border-dark-border';

const EGG_GRADES = [
  { key: 'eggsSmall',      label: 'Small',          color: 'text-blue-600',   accent: 'bg-blue-50 dark:bg-blue-900/20'   },
  { key: 'eggsMedium',     label: 'Medium',         color: 'text-green-600',  accent: 'bg-green-50 dark:bg-green-900/20' },
  { key: 'eggsLarge',      label: 'Large',          color: 'text-yellow-600', accent: 'bg-yellow-50 dark:bg-yellow-900/20' },
  { key: 'eggsExtraLarge', label: 'Extra Large',    color: 'text-orange-600', accent: 'bg-orange-50 dark:bg-orange-900/20' },
  { key: 'eggsReject',     label: 'Reject/Cracked', color: 'text-red-500',    accent: 'bg-red-50 dark:bg-red-900/20'    },
];

type ProductionFormValues = {
  batchId: string;
  shift: string;
  eggsSmall: number;
  eggsMedium: number;
  eggsLarge: number;
  eggsExtraLarge: number;
  eggsReject: number;
};


export function DailyProductionEntry() {
  const navigate = useNavigate();
  const { data: batches = [] } = useBatches({ isActive: true });
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: (data: any) => api.post('/production/entries', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production'] }),
  });

  const { register, handleSubmit, watch } = useForm<ProductionFormValues>({
    defaultValues: {
      shift: dayjs().hour() < 13 ? 'AM' : 'PM',
      eggsSmall: 0, eggsMedium: 0, eggsLarge: 0, eggsExtraLarge: 0, eggsReject: 0,
    },
  });

  const s  = Number(watch('eggsSmall') ?? 0);
  const m  = Number(watch('eggsMedium') ?? 0);
  const l  = Number(watch('eggsLarge') ?? 0);
  const xl = Number(watch('eggsExtraLarge') ?? 0);
  const r  = Number(watch('eggsReject') ?? 0);
  const total = s + m + l + xl + r;
  const trays = (total / 30).toFixed(1);
  const selectedBatch = batches.find((b: any) => b.id === watch('batchId'));

  if (submit.isSuccess) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center max-w-lg mx-auto mt-20">
        <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Egg Entry Submitted!</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Total: <span className="font-bold text-yellow-600">{total} eggs</span> · {trays} trays
        </p>
        <button onClick={() => navigate('/attendant')} className="mt-6 bg-brand-green text-white rounded-xl px-8 py-3 font-semibold">
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/attendant')}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Egg Collection</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{dayjs().format('dddd, D MMMM YYYY')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(data => submit.mutate({
        ...data,
        houseId: selectedBatch?.houseId,
        entryDate: dayjs().format('YYYY-MM-DD'),
        totalEggs: total,
      }))} className="space-y-5">

        {/* Batch + Shift */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className={cardCls}>
            <label className={labelCls}>Batch *</label>
            <select {...register('batchId', { required: true })} className={inputCls}>
              <option value="">Select batch...</option>
              {batches.filter((b: any) => b.birdType === 'LAYER_COMMERCIAL').map((b: any) => (
                <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>
              ))}
            </select>
          </div>

          <div className={cardCls}>
            <label className={labelCls}>Shift *</label>
            <div className="flex gap-3">
              {['AM', 'PM'].map(s => (
                <label key={s} className="flex-1">
                  <input type="radio" {...register('shift')} value={s} className="sr-only" />
                  <div className={`text-center py-3 rounded-xl border-2 cursor-pointer font-semibold transition-colors
                    ${watch('shift') === s
                      ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600'
                      : 'border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 hover:border-gray-300'}`}>
                    {s}
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Egg grades — 2-col on desktop (5 grades + total summary) */}
        <div className={cardCls}>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Egg Count by Grade</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {EGG_GRADES.map(({ key, label, color, accent }) => (
              <div key={key} className={`${accent} rounded-xl p-3 flex items-center gap-3`}>
                <span className={`w-28 text-sm font-semibold ${color} flex-shrink-0`}>{label}</span>
                <input {...register(key as any)} type="number" min="0" inputMode="numeric"
                  className="flex-1 bg-white dark:bg-dark-bg border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-xl font-bold text-center focus:outline-none focus:ring-2 focus:ring-yellow-500" />
              </div>
            ))}
          </div>

          {/* Total summary */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4 text-center">
              <p className="text-sm text-yellow-600 font-medium">Total Eggs</p>
              <p className="text-4xl font-bold text-yellow-600 mt-1">{total}</p>
            </div>
            <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-4 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Estimated Trays</p>
              <p className="text-4xl font-bold text-gray-700 dark:text-gray-200 mt-1">{trays}</p>
            </div>
          </div>
        </div>

        <button type="submit" disabled={submit.isPending}
          className="w-full bg-yellow-600 text-white rounded-2xl py-4 text-base font-bold shadow-lg min-h-[60px] disabled:opacity-60 hover:bg-yellow-700 transition-colors">
          {submit.isPending ? 'Submitting...' : `Submit — ${total} Eggs →`}
        </button>
      </form>
    </div>
  );
}

export default DailyProductionEntry;
