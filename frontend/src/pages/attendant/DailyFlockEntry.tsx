import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, WifiOff } from 'lucide-react';
import { useCreateEntry, useBatches } from '../../hooks/useFlock';
import { useOfflineMutation } from '../../hooks/useOfflineSync';
import { useOfflineStore } from '../../stores/offline.store';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

const schema = z.object({
  batchId: z.string().min(1, 'Select a batch'),
  houseId: z.string().min(1, 'House required'),
  shift: z.enum(['AM', 'PM']),
  openingCount: z.coerce.number().int().min(0),
  mortalityCount: z.coerce.number().int().min(0),
  mortalityCause: z.string().optional(),
  waterConsumptionL: z.coerce.number().min(0).optional(),
  temperatureCelsius: z.coerce.number().min(-5).max(50).optional(),
  notes: z.string().optional(),
  cullingCount: z.coerce.number().int().min(0).optional(),
}).refine(d => d.mortalityCount <= d.openingCount, {
  message: 'Mortality cannot exceed opening count',
  path: ['mortalityCount'],
});

type FormData = z.infer<typeof schema>;

const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 text-base bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const labelCls = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1';
const cardCls  = 'bg-white dark:bg-dark-card rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100 dark:border-dark-border';

export function DailyFlockEntry() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: batches = [] } = useBatches({ isActive: true });
  const createEntry = useCreateEntry();
  const { isOnline } = useOfflineStore();
  const [submitted, setSubmitted] = React.useState(false);
  const [wasQueued, setWasQueued] = React.useState(false);

  const { mutate: offlineMutate } = useOfflineMutation({
    endpoint: '/flock/entries',
    method: 'POST',
    type: 'flock',
    onSuccess: () => { setSubmitted(true); setWasQueued(false); },
    onQueued: () => { setSubmitted(true); setWasQueued(true); },
  });

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      shift: dayjs().hour() < 13 ? 'AM' : 'PM',
      mortalityCount: 0,
      cullingCount: 0,
    },
  });

  const mortality = watch('mortalityCount') ?? 0;
  const opening = watch('openingCount') ?? 0;
  const closing = Math.max(0, opening - mortality);
  const selectedBatch = batches.find((b: any) => b.id === watch('batchId'));

  const onSubmit = async (data: FormData) => {
    await offlineMutate({ ...data, entryDate: dayjs().format('YYYY-MM-DD') } as any);
  };

  if (submitted) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center max-w-lg mx-auto mt-20">
        {wasQueued ? (
          <>
            <WifiOff className="w-16 h-16 text-amber-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('common.savedOffline')}</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2">{t('flock.savedOfflineDesc')}</p>
          </>
        ) : (
          <>
            <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('flock.submitted')}</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2">{t('flock.submittedDesc')}</p>
          </>
        )}
        <button onClick={() => navigate('/attendant')} className="mt-6 bg-brand-green text-white rounded-xl px-8 py-3 font-semibold">
          {t('common.backToHome')}
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
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('flock.pageTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{dayjs().format('dddd, D MMMM YYYY')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {/* Batch + Shift — side by side on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className={cardCls}>
            <label className={labelCls}>{t('flock.batch')} *</label>
            <select {...register('batchId')} className={inputCls}>
              <option value="">{t('flock.selectBatch')}</option>
              {batches.map((b: any) => (
                <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>
              ))}
            </select>
            {errors.batchId && <p className="text-red-500 text-sm mt-1">{errors.batchId.message}</p>}
            {selectedBatch && <input type="hidden" {...register('houseId')} value={selectedBatch.houseId} />}
          </div>

          <div className={cardCls}>
            <label className={labelCls}>{t('flock.shift')} *</label>
            <div className="flex gap-3">
              {(['AM', 'PM'] as const).map(s => (
                <label key={s} className="flex-1">
                  <input type="radio" {...register('shift')} value={s} className="sr-only" />
                  <div className={`text-center py-3 rounded-xl border-2 cursor-pointer font-semibold transition-colors
                    ${watch('shift') === s
                      ? 'border-brand-green bg-brand-green/10 text-brand-green'
                      : 'border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 hover:border-gray-300'}`}>
                    {t(`flock.shift_${s}`)}
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Bird counts */}
        <div className={cardCls}>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Bird Counts *</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('flock.openingCount')}</label>
              <input {...register('openingCount')} type="number" min="0" inputMode="numeric"
                className={`${inputCls} text-center text-xl font-bold`} />
            </div>
            <div>
              <label className={labelCls}>{t('flock.mortality')}</label>
              <input {...register('mortalityCount')} type="number" min="0" inputMode="numeric"
                className={`${inputCls} text-center text-xl font-bold`} />
              {errors.mortalityCount && <p className="text-red-500 text-sm mt-1">{errors.mortalityCount.message}</p>}
            </div>
            </div>
          {/* Closing count */}
          <div className="mt-4 bg-brand-green/10 dark:bg-brand-green/20 rounded-xl p-4 text-center">
            <p className="text-sm text-brand-green font-medium">{t('flock.closingCount')}</p>
            <p className="text-4xl font-bold text-brand-green mt-1">{closing}</p>
          </div>
        </div>

        {/* Environmental + Notes — side by side on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className={cardCls}>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Environmental</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('flock.waterConsumption')}</label>
                <input {...register('waterConsumptionL')} type="number" min="0" step="0.1" inputMode="decimal"
                  className={`${inputCls} text-center`} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('flock.temperature')}</label>
                <input {...register('temperatureCelsius')} type="number" step="0.1" inputMode="decimal"
                  className={`${inputCls} text-center`} />
              </div>
            </div>
          </div>

          <div className={cardCls}>
            <label className={labelCls}>{t('flock.notes')} ({t('common.optional')})</label>
            <textarea {...register('notes')} rows={3}
              className={`${inputCls} resize-none`}
              placeholder="Optional notes..." />
          </div>
        </div>

        {!isOnline && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm">
            <WifiOff className="w-4 h-4 shrink-0" />
            {t('flock.savedOfflineDesc')}
          </div>
        )}

        <button type="submit"
          className="w-full bg-brand-green text-white rounded-2xl py-4 text-base font-bold shadow-lg hover:bg-brand-mid transition-colors min-h-[60px]">
          {isOnline ? t('flock.submitEntry') : t('common.saveOffline')}
        </button>
      </form>
    </div>
  );
}

export default DailyFlockEntry;
