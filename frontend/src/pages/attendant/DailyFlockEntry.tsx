import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { useCreateEntry, useBatches } from '../../hooks/useFlock';
import dayjs from 'dayjs';

const schema = z.object({
  batchId: z.string().min(1, 'Select a batch'),
  houseId: z.string().min(1, 'House required'),
  shift: z.enum(['AM', 'PM']),
  openingCount: z.coerce.number().int().min(0),
  mortalityCount: z.coerce.number().int().min(0),
  mortalityCause: z.string().optional(),
  cullingCount: z.coerce.number().int().min(0).optional(),
  waterConsumptionL: z.coerce.number().min(0).optional(),
  temperatureCelsius: z.coerce.number().min(-5).max(50).optional(),
  notes: z.string().optional(),
}).refine(d => d.mortalityCount + (d.cullingCount ?? 0) <= d.openingCount, {
  message: 'Mortality + culling cannot exceed opening count',
  path: ['mortalityCount'],
});

type FormData = z.infer<typeof schema>;

export function DailyFlockEntry() {
  const navigate = useNavigate();
  const { data: batches = [] } = useBatches({ isActive: true });
  const createEntry = useCreateEntry();

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      shift: dayjs().hour() < 13 ? 'AM' : 'PM',
      mortalityCount: 0,
      cullingCount: 0,
    },
  });

  const mortality = watch('mortalityCount') ?? 0;
  const culling = watch('cullingCount') ?? 0;
  const opening = watch('openingCount') ?? 0;
  const closing = Math.max(0, opening - mortality - culling);

  const selectedBatch = batches.find((b: any) => b.id === watch('batchId'));

  const onSubmit = async (data: FormData) => {
    await createEntry.mutateAsync({
      ...data,
      entryDate: dayjs().format('YYYY-MM-DD'),
    });
    navigate('/attendant');
  };

  if (createEntry.isSuccess) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-800">Entry Submitted!</h2>
        <p className="text-gray-500 mt-2">Awaiting supervisor verification.</p>
        <button onClick={() => navigate('/attendant')} className="mt-6 bg-brand-green text-white rounded-xl px-8 py-3 font-semibold">
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate('/attendant')} className="p-2">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-800">Flock Entry</h1>
          <p className="text-sm text-gray-500">{dayjs().format('D MMMM YYYY')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Batch selector */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <label className="block text-sm font-semibold text-gray-700 mb-2">Batch *</label>
          <select {...register('batchId')} className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base bg-white">
            <option value="">Select batch...</option>
            {batches.map((b: any) => (
              <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>
            ))}
          </select>
          {errors.batchId && <p className="text-red-500 text-sm mt-1">{errors.batchId.message}</p>}
          {selectedBatch && (
            <input type="hidden" {...register('houseId')} value={selectedBatch.houseId} />
          )}
        </div>

        {/* Shift selector */}
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

        {/* Bird counts */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-4">
          <p className="text-sm font-semibold text-gray-700">Bird Counts *</p>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Opening Count (start of shift)</label>
            <input {...register('openingCount')} type="number" min="0" inputMode="numeric"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xl font-bold text-center" />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Deaths Today</label>
            <input {...register('mortalityCount')} type="number" min="0" inputMode="numeric"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xl font-bold text-center" />
            {errors.mortalityCount && <p className="text-red-500 text-sm mt-1">{errors.mortalityCount.message}</p>}
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Culled Today (optional)</label>
            <input {...register('cullingCount')} type="number" min="0" inputMode="numeric"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xl font-bold text-center" />
          </div>

          {/* Auto-computed closing count */}
          <div className="bg-brand-light rounded-xl p-3 text-center">
            <p className="text-sm text-brand-green font-medium">Closing Count (auto-calculated)</p>
            <p className="text-3xl font-bold text-brand-green mt-1">{closing}</p>
          </div>
        </div>

        {/* Environmental */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-4">
          <p className="text-sm font-semibold text-gray-700">Environmental (optional)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Water (litres)</label>
              <input {...register('waterConsumptionL')} type="number" min="0" step="0.1" inputMode="decimal"
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base text-center" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Temp (°C)</label>
              <input {...register('temperatureCelsius')} type="number" step="0.1" inputMode="decimal"
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base text-center" />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <label className="block text-sm font-semibold text-gray-700 mb-2">Notes (optional)</label>
          <textarea {...register('notes')} rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-base resize-none"
            placeholder="Any observations..." />
        </div>

        {/* Submit */}
        {createEntry.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
            {(createEntry.error as any)?.response?.data?.message ?? 'Submission failed. Please check your entries.'}
          </div>
        )}

        <button type="submit" disabled={createEntry.isPending}
          className="w-full bg-brand-green text-white rounded-2xl py-4 text-base font-bold
                     shadow-lg hover:bg-brand-mid transition-colors disabled:opacity-60 min-h-[60px]">
          {createEntry.isPending ? 'Submitting...' : 'Submit Flock Entry →'}
        </button>
      </form>
    </div>
  );
}
