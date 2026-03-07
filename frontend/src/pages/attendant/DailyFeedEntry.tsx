import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { useLogFeedIntake } from '../../hooks/useFeed';
import { useBatches } from '../../hooks/useFlock';
import dayjs from 'dayjs';

export function DailyFeedEntry() {
  const navigate = useNavigate();
  const { data: batches = [] } = useBatches({ isActive: true });
  const logIntake = useLogFeedIntake();
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: { wastageKg: 0 },
  });

  const selectedBatch = batches.find((b: any) => b.id === watch('batchId'));

  if (logIntake.isSuccess) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-800">Feed Entry Logged!</h2>
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
          <h1 className="text-lg font-bold text-gray-800">Feed Entry</h1>
          <p className="text-sm text-gray-500">{dayjs().format('D MMMM YYYY')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(data => logIntake.mutate({ ...data, entryDate: dayjs().format('YYYY-MM-DD'), houseId: selectedBatch?.houseId ?? '' }))} className="space-y-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <label className="block text-sm font-semibold text-gray-700 mb-2">Batch *</label>
          <select {...register('batchId', { required: true })} className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base bg-white">
            <option value="">Select batch...</option>
            {batches.map((b: any) => (
              <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <label className="block text-sm font-semibold text-gray-700 mb-2">Feed Type *</label>
          <select {...register('feedType', { required: true })} className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base bg-white">
            <option value="">Select feed type...</option>
            <option value="LAYER_MASH">Layer Mash</option>
            <option value="CHICK_MASH">Chick Mash</option>
            <option value="GROWER_MASH">Grower Mash</option>
            <option value="KIENYEJI_STARTER">Kienyeji Starter</option>
            <option value="KIENYEJI_GROWER">Kienyeji Grower</option>
            <option value="KIENYEJI_FINISHER">Kienyeji Finisher</option>
          </select>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Feed Dispensed (kg) *</label>
            <input {...register('quantityDispensedKg', { required: true, min: 0.1 })}
              type="number" step="0.1" min="0" inputMode="decimal"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-2xl font-bold text-center" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Wastage (kg) — enter 0 if none</label>
            <input {...register('wastageKg')} type="number" step="0.1" min="0" inputMode="decimal"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base text-center" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <label className="block text-sm font-semibold text-gray-700 mb-2">Notes (optional)</label>
          <textarea {...register('notes')} rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-base resize-none"
            placeholder="Any observations..." />
        </div>

        <button type="submit" disabled={logIntake.isPending}
          className="w-full bg-brand-teal text-white rounded-2xl py-4 text-base font-bold shadow-lg min-h-[60px] disabled:opacity-60">
          {logIntake.isPending ? 'Submitting...' : 'Submit Feed Entry →'}
        </button>
      </form>
    </div>
  );
}
