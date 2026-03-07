import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useBatches } from '../../hooks/useFlock';
import dayjs from 'dayjs';

export function DailyProductionEntry() {
  const navigate = useNavigate();
  const { data: batches = [] } = useBatches({ isActive: true });
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: (data: any) => api.post('/production/entries', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production'] }),
  });

  const { register, handleSubmit, watch } = useForm({
    defaultValues: {
      shift: dayjs().hour() < 13 ? 'AM' : 'PM',
      eggsSmall: 0, eggsMedium: 0, eggsLarge: 0, eggsExtraLarge: 0, eggsReject: 0,
    },
  });

  const s = watch('eggsSmall') ?? 0;
  const m = watch('eggsMedium') ?? 0;
  const l = watch('eggsLarge') ?? 0;
  const xl = watch('eggsExtraLarge') ?? 0;
  const r = watch('eggsReject') ?? 0;
  const total = Number(s) + Number(m) + Number(l) + Number(xl) + Number(r);
  const selectedBatch = batches.find((b: any) => b.id === watch('batchId'));

  if (submit.isSuccess) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-800">Egg Entry Submitted!</h2>
        <p className="text-gray-500 mt-1">Total: <span className="font-bold text-brand-green">{total} eggs</span></p>
        <button onClick={() => navigate('/attendant')} className="mt-6 bg-brand-green text-white rounded-xl px-8 py-3 font-semibold">
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate('/attendant')} className="p-2"><ArrowLeft className="w-6 h-6" /></button>
        <div>
          <h1 className="text-lg font-bold text-gray-800">Egg Collection</h1>
          <p className="text-sm text-gray-500">{dayjs().format('D MMMM YYYY')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(data => submit.mutate({
        ...data,
        houseId: selectedBatch?.houseId,
        entryDate: dayjs().format('YYYY-MM-DD'),
        totalEggs: total,
      }))} className="space-y-4">

        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <label className="block text-sm font-semibold text-gray-700 mb-2">Batch *</label>
          <select {...register('batchId', { required: true })} className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base bg-white">
            <option value="">Select batch...</option>
            {batches.filter((b: any) => b.birdType === 'LAYER_COMMERCIAL').map((b: any) => (
              <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <label className="block text-sm font-semibold text-gray-700 mb-2">Shift *</label>
          <div className="flex gap-3">
            {['AM', 'PM'].map(s => (
              <label key={s} className="flex-1">
                <input type="radio" {...register('shift')} value={s} className="sr-only" />
                <div className={`text-center py-3 rounded-xl border-2 cursor-pointer font-semibold transition-colors ${watch('shift') === s ? 'border-brand-green bg-brand-light text-brand-green' : 'border-gray-200 text-gray-600'}`}>
                  {s}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Egg grade inputs */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Egg Count by Grade</p>
          <div className="space-y-3">
            {[
              { key: 'eggsSmall', label: 'Small', color: 'text-blue-600' },
              { key: 'eggsMedium', label: 'Medium', color: 'text-green-600' },
              { key: 'eggsLarge', label: 'Large', color: 'text-yellow-600' },
              { key: 'eggsExtraLarge', label: 'Extra Large', color: 'text-orange-600' },
              { key: 'eggsReject', label: 'Reject / Cracked', color: 'text-red-500' },
            ].map(({ key, label, color }) => (
              <div key={key} className="flex items-center gap-3">
                <span className={`w-28 text-sm font-medium ${color}`}>{label}</span>
                <input {...register(key as any)} type="number" min="0" inputMode="numeric"
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-3 text-xl font-bold text-center" />
              </div>
            ))}
          </div>
          <div className="mt-4 bg-brand-light rounded-xl p-3 text-center">
            <p className="text-sm text-brand-green font-medium">Total Eggs</p>
            <p className="text-3xl font-bold text-brand-green">{total}</p>
          </div>
        </div>

        <button type="submit" disabled={submit.isPending}
          className="w-full bg-yellow-600 text-white rounded-2xl py-4 text-base font-bold shadow-lg min-h-[60px] disabled:opacity-60">
          {submit.isPending ? 'Submitting...' : `Submit — ${total} Eggs →`}
        </button>
      </form>
    </div>
  );
}
