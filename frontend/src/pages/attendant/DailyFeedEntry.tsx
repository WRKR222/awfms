import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, WifiOff } from 'lucide-react';
import { useBatches } from '../../hooks/useFlock';
import { useOfflineMutation } from '../../hooks/useOfflineSync';
import { useOfflineStore } from '../../stores/offline.store';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 text-base bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-teal';
const labelCls = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1';
const cardCls  = 'bg-white dark:bg-dark-card rounded-2xl p-4 md:p-6 shadow-sm border border-gray-100 dark:border-dark-border';

type FeedFormValues = {
  batchId: string;
  feedType: string;
  quantityDispensedKg: number;
  notes?: string;
};

export function DailyFeedEntry() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: batches = [] } = useBatches({ isActive: true });
  const { isOnline } = useOfflineStore();
  const [submitted, setSubmitted] = useState(false);
  const [wasQueued, setWasQueued] = useState(false);

  const { mutate: offlineMutate } = useOfflineMutation({
    endpoint: '/feed/intake',
    method: 'POST',
    type: 'feed',
    onSuccess: () => { setSubmitted(true); setWasQueued(false); },
    onQueued:  () => { setSubmitted(true); setWasQueued(true); },
  });

  const { register, handleSubmit, watch } = useForm<FeedFormValues>();
  const dispensed = Number(watch('quantityDispensedKg') ?? 0);
  const selectedBatch = batches.find((b: any) => b.id === watch('batchId'));

  if (submitted) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center max-w-lg mx-auto mt-20">
        {wasQueued ? (
          <>
            <WifiOff className="w-16 h-16 text-amber-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('common.savedOffline')}</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2">{t('feed.savedOfflineDesc')}</p>
          </>
        ) : (
          <>
            <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('feed.submitted')}</h2>
          </>
        )}
        <button onClick={() => navigate('/attendant')} className="mt-6 bg-brand-teal text-white rounded-xl px-8 py-3 font-semibold">
          {t('common.backToHome')}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">

      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/attendant')}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('feed.pageTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{dayjs().format('dddd, D MMMM YYYY')}</p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit(data =>
          offlineMutate({
            ...data,
            entryDate: dayjs().format('YYYY-MM-DD'),
            houseId: selectedBatch?.houseId ?? '',
          } as any)
        )}
        className="space-y-4"
      >
        <div className={cardCls}>
          <label className={labelCls}>{t('feed.batch')} *</label>
          <select {...register('batchId', { required: true })} className={inputCls}>
            <option value="">{t('feed.selectBatch')}</option>
            {batches.map((b: any) => (
              <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>
            ))}
          </select>
        </div>

        <div className={cardCls}>
          <label className={labelCls}>{t('feed.feedType')} *</label>
          <select {...register('feedType', { required: true })} className={inputCls}>
            <option value="">{t('feed.selectFeedType')}</option>
            {(['LAYER_MASH','CHICK_MASH','GROWER_MASH','KIENYEJI_STARTER','KIENYEJI_GROWER','KIENYEJI_FINISHER'] as const).map(ft => (
              <option key={ft} value={ft}>{t(`feed.feedTypes.${ft}`)}</option>
            ))}
          </select>
          <div className="mt-3 bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p className="font-semibold text-gray-600 dark:text-gray-300 mb-1">Daily feed reference (per bird):</p>
            <p>🐣 <strong>Brooders (0–6 wks):</strong> ~10–15 g/day/chick · Chick Mash</p>
            <p>🐔 <strong>Growers (6–18 wks):</strong> ~50–80 g/day/bird · Grower Mash</p>
            <p>🥚 <strong>Layers (18+ wks):</strong> ~110–130 g/day/hen · Layer Mash</p>
            <p className="text-gray-400 italic mt-1">Unit recorded: <strong>kg</strong> (kilograms dispensed this session)</p>
          </div>
        </div>

        <div className={cardCls}>
          <label className={labelCls}>{t('feed.quantity')} *</label>
          <input
            {...register('quantityDispensedKg', { required: true, min: 0.1 })}
            type="number" step="0.1" min="0" inputMode="decimal"
            className={`${inputCls} text-center text-2xl font-bold`}
            placeholder="0.0"
          />
          {dispensed > 0 && (
            <div className="mt-3 bg-brand-teal/10 dark:bg-brand-teal/20 rounded-xl p-3 flex items-center justify-between">
              <p className="text-sm text-brand-teal font-medium">{t('feed.feedDispensed')}</p>
              <p className="text-2xl font-bold text-brand-teal">{dispensed.toFixed(1)} kg</p>
            </div>
          )}
        </div>

        <div className={cardCls}>
          <label className={labelCls}>{t('feed.notes')} ({t('common.optional')})</label>
          <textarea
            {...register('notes')}
            rows={3}
            className={`${inputCls} resize-none`}
            placeholder={t('feed.anyObservations')}
          />
        </div>

        {!isOnline && (
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-amber-700 dark:text-amber-400 text-sm">
            <WifiOff className="w-4 h-4 shrink-0" />
            {t('feed.savedOfflineDesc')}
          </div>
        )}

        <button type="submit"
          className="w-full bg-brand-teal text-white rounded-2xl py-4 text-base font-bold shadow-lg min-h-[60px] hover:opacity-90 transition-opacity">
          {isOnline ? t('feed.submitEntry') : t('common.saveOffline')}
        </button>
      </form>
    </div>
  );
}

export default DailyFeedEntry;