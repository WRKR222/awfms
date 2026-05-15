import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, Truck, Package, Clock, AlertCircle, Send, AlertTriangle } from 'lucide-react';
import api from '../../lib/api/client';
import dayjs from 'dayjs';

const FEED_TYPES = [
  { value: 'CHICK_MASH',        label: 'Chick Mash' },
  { value: 'GROWER_MASH',       label: 'Grower Mash' },
  { value: 'LAYER_MASH',        label: 'Layer Mash' },
  { value: 'KIENYEJI_STARTER',  label: 'Kienyeji Starter' },
  { value: 'KIENYEJI_GROWER',   label: 'Kienyeji Grower' },
  { value: 'KIENYEJI_FINISHER', label: 'Kienyeji Finisher' },
];

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const lCls = 'block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide';
const cardCls = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';

export default function StoreFeedDistribution() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'requests' | 'manual'>('requests');

  const { data: batches = [] } = useQuery({
    queryKey: ['batches', 'active'],
    queryFn: () => api.get('/flock/batches?isActive=true').then(r => r.data),
  });

  // Pending feed requests from Production Manager
  const { data: feedRequests = [] } = useQuery({
    queryKey: ['feed-requests', 'pending'],
    queryFn: () => api.get('/feed/requests?status=PENDING').then(r => r.data).catch(() => []),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { register, handleSubmit, watch, reset } = useForm({
    defaultValues: { batchId: '', feedType: 'LAYER_MASH', quantityKg: '', distributionDate: dayjs().format('YYYY-MM-DD'), notes: '' },
  });

  const submit = useMutation({
    mutationFn: (d: any) => api.post('/store/feed-distribution', d).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['feed'] }); },
  });

  const [showPRPrompt, setShowPRPrompt] = useState(false);

  const issueRequest = useMutation({
    mutationFn: (requestId: string) => api.patch(`/feed/requests/${requestId}/issue`, { issuedAt: new Date().toISOString() }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed-requests'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['store-items'] });
      setShowPRPrompt(true);
      setTimeout(() => setShowPRPrompt(false), 8000);
    },
  });

  const selectedBatch = batches.find((b: any) => b.id === watch('batchId'));
  const qty = Number(watch('quantityKg') ?? 0);
  const pendingCount = (feedRequests as any[]).length;

  if (submit.isSuccess) {
    return (
      <div className="p-6 text-center flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-4">
          <CheckCircle className="w-9 h-9 text-green-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Feed Issued</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Distribution recorded successfully</p>
        <div className="flex gap-3 mt-6">
          <button onClick={() => { submit.reset(); reset(); }} className="bg-gray-100 dark:bg-dark-card text-gray-700 dark:text-gray-200 rounded-xl px-5 py-2.5 text-sm font-semibold">Log Another</button>
          <button onClick={() => navigate('/store')} className="bg-brand-green text-white rounded-xl px-5 py-2.5 text-sm font-semibold">Back to Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate('/store')} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-500" /> Feed Distribution
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{dayjs().format('dddd, D MMMM YYYY')}</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 dark:bg-dark-card p-1 rounded-xl mb-5">
        <button
          onClick={() => setActiveTab('requests')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'requests' ? 'bg-white dark:bg-dark-bg text-brand-green shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
        >
          <Clock className="w-4 h-4" />
          Production Manager's Requests
          {pendingCount > 0 && <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{pendingCount}</span>}
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'manual' ? 'bg-white dark:bg-dark-bg text-brand-green shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
        >
          <Package className="w-4 h-4" />
          Manual Issue
        </button>
      </div>

      {/* Tab: Production Manager's Requests */}
      {activeTab === 'requests' && (
        <div className="space-y-3">
          {(feedRequests as any[]).length === 0 ? (
            <div className={`${cardCls} text-center py-10`}>
              <Clock className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">No pending feed requests</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">The Production Manager will send requests here</p>
            </div>
          ) : (
            (feedRequests as any[]).map((req: any) => (
              <div key={req.id} className={`${cardCls} border-l-4 border-l-amber-400`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800 dark:text-gray-100 text-sm">{req.feedType?.replace(/_/g, ' ')}</span>
                      <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    </div>
                    <p className="text-sm text-brand-green font-bold mt-1">{req.quantityKg} kg requested</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                      <span>Requested: {dayjs(req.requestDate).format('D MMM YYYY')}</span>
                      {req.notes && <span>· {req.notes}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => issueRequest.mutate(req.id)}
                    disabled={issueRequest.isPending}
                    className="flex items-center gap-1.5 bg-brand-green text-white px-3 py-2 rounded-xl text-xs font-bold shrink-0 hover:bg-green-800 transition-colors disabled:opacity-60"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {issueRequest.isPending ? 'Issuing…' : 'Issue Now'}
                  </button>
                </div>
                {issueRequest.isSuccess && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle className="w-3.5 h-3.5" /> Issued successfully
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Manual Issue */}
      {activeTab === 'manual' && (
        <form
          onSubmit={handleSubmit(d => submit.mutate({ ...d, houseId: selectedBatch?.houseId, quantityKg: Number(d.quantityKg) }))}
          className="space-y-3"
        >
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-400">Use this for feed issues not linked to a manager request (e.g. emergency, top-up).</p>
          </div>

          <div className={cardCls + ' space-y-4'}>
            <div>
              <label className={lCls}>Batch *</label>
              <select {...register('batchId', { required: true })} className={iCls}>
                <option value="">Select batch...</option>
                {batches.map((b: any) => <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lCls}>Feed Type *</label>
              <select {...register('feedType', { required: true })} className={iCls}>
                {FEED_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lCls}>Quantity (kg) *</label>
                <input
                  {...register('quantityKg', { required: true, min: 0.1 })}
                  type="number" min="0" step="0.1" inputMode="decimal"
                  placeholder="0.0"
                  className={`${iCls} text-center font-bold`}
                />
                {qty > 0 && <p className="text-xs text-brand-green mt-1 text-center font-medium">{qty} kg</p>}
              </div>
              <div>
                <label className={lCls}>Date *</label>
                <input {...register('distributionDate')} type="date" className={iCls} />
              </div>
            </div>
            <div>
              <label className={lCls}>Notes <span className="font-normal text-gray-400 normal-case">(optional)</span></label>
              <input {...register('notes')} placeholder="Optional remarks..." className={iCls} />
            </div>
          </div>

          {qty > 0 && selectedBatch && (
            <div className="bg-brand-green/10 dark:bg-brand-green/20 rounded-xl p-3 flex items-center gap-3">
              <Package className="w-5 h-5 text-brand-green flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-brand-green">{qty} kg to {selectedBatch.batchCode}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{watch('feedType')?.replace(/_/g, ' ')} · {watch('distributionDate')}</p>
              </div>
            </div>
          )}

          {submit.isError && (
            <p className="text-red-500 text-sm text-center bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              {(submit.error as any)?.response?.data?.message ?? 'Submission failed. Please try again.'}
            </p>
          )}

          <button type="submit" disabled={submit.isPending} className="w-full bg-brand-green text-white rounded-2xl py-3.5 text-sm font-bold shadow-lg disabled:opacity-60 hover:bg-green-800 transition-colors">
            {submit.isPending ? 'Logging...' : 'Issue Feed →'}
          </button>
        </form>
      )}
    </div>
  );
}
