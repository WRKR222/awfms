import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../../lib/api';
import { useFeedStock } from '../../hooks/useFeed';
import { useBatches } from '../../hooks/useFlock';
import dayjs from '../../lib/dayjs';
import {
  AlertTriangle, CheckCircle, Package, X, ChevronDown,
  ChevronUp, Truck, Info, Calendar, Hash, DollarSign, FileText,
  BarChart3, Layers, Clock
} from 'lucide-react';
import { BrooderFeedCalendar } from '../../components/shared/BrooderFeedCalendar';

// ── Types ────────────────────────────────────────────────────────────────────
type FeedType =
  | 'CHICK_MASH' | 'GROWER_MASH' | 'LAYER_MASH'
  | 'KIENYEJI_STARTER' | 'KIENYEJI_GROWER' | 'KIENYEJI_FINISHER';

const FEED_LABELS: Record<FeedType, { label: string; tip: string; color: string; bg: string }> = {
  LAYER_MASH:        { label: 'Layer Mash',        tip: 'Complete feed for laying hens in production phase (18+ weeks). Contains calcium for strong eggshells.',    color: 'text-brand-green',  bg: 'bg-brand-green/10 dark:bg-brand-green/20'  },
  CHICK_MASH:        { label: 'Chick Mash',         tip: 'High-protein starter feed for day-old chicks up to 6 weeks. Critical for early development.',              color: 'text-yellow-600',   bg: 'bg-yellow-50 dark:bg-yellow-900/20'        },
  GROWER_MASH:       { label: 'Grower Mash',        tip: 'Balanced feed for pullets from 6–18 weeks. Lower protein than chick mash, builds bone and muscle.',        color: 'text-blue-600',     bg: 'bg-blue-50 dark:bg-blue-900/20'            },
  KIENYEJI_STARTER:  { label: 'Kienyeji Starter',   tip: 'Starter feed for indigenous Kienyeji chicks (0–4 weeks). Higher energy for hardy local breeds.',           color: 'text-orange-600',   bg: 'bg-orange-50 dark:bg-orange-900/20'        },
  KIENYEJI_GROWER:   { label: 'Kienyeji Grower',    tip: 'Grower feed for Kienyeji birds (4–8 weeks). Formulated for slower-growing indigenous genetics.',            color: 'text-amber-600',    bg: 'bg-amber-50 dark:bg-amber-900/20'          },
  KIENYEJI_FINISHER: { label: 'Kienyeji Finisher',  tip: 'Finishing feed for Kienyeji birds (8+ weeks) approaching market weight or point of lay.',                  color: 'text-purple-600',   bg: 'bg-purple-50 dark:bg-purple-900/20'        },
};

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5
        w-52 text-center leading-relaxed
        opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg
        after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2
        after:border-4 after:border-transparent after:border-t-gray-900 dark:after:border-t-gray-700">
        {tip}
      </span>
    </span>
  );
}

// ── Stock gauge card ──────────────────────────────────────────────────────────
function StockGauge({ feedType, stock }: { feedType: FeedType; stock: any }) {
  const cfg = FEED_LABELS[feedType];
  const days = stock.daysRemaining;
  const isLow = days <= 3;
  const isMedium = days > 3 && days <= 7;

  // Gauge fill: 0 days = 0%, 30+ days = 100%
  const fillPct = Math.min(100, (days / 30) * 100);
  const barColor = isLow ? 'bg-red-500' : isMedium ? 'bg-amber-400' : 'bg-brand-green';

  return (
    <div className={`rounded-2xl border p-4 transition-all
      ${isLow
        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
        : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border'
      }`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <Tooltip tip={cfg.tip}>
            <p className={`text-sm font-bold ${cfg.color} cursor-default flex items-center gap-1`}>
              {cfg.label}
              <Info className="w-3 h-3 opacity-50" />
            </p>
          </Tooltip>
        </div>
        {isLow && (
          <Tooltip tip="Stock is critically low — order immediately">
            <span className="flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400
              bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded-full cursor-default">
              <AlertTriangle className="w-3 h-3" /> LOW
            </span>
          </Tooltip>
        )}
        {!isLow && days > 20 && (
          <Tooltip tip="Stock levels are healthy">
            <span className="flex items-center gap-1 text-xs font-bold text-green-600 dark:text-green-400
              bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded-full cursor-default">
              <CheckCircle className="w-3 h-3" /> OK
            </span>
          </Tooltip>
        )}
      </div>

      {/* Stock value */}
      <div className="mb-3">
        <Tooltip tip="Current physical stock on hand (deliveries minus all dispensed amounts)">
          <p className={`text-2xl font-bold cursor-default ${isLow ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>
            {stock.currentStockKg.toFixed(0)}
            <span className="text-sm font-normal text-gray-400 ml-1">kg</span>
          </p>
        </Tooltip>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-100 dark:bg-dark-bg rounded-full overflow-hidden mb-3">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>

      {/* Footer stats */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <Tooltip tip="Estimated days remaining at current average daily usage rate">
          <span className={`font-semibold cursor-default ${isLow ? 'text-red-600 dark:text-red-400' : isMedium ? 'text-amber-600 dark:text-amber-400' : 'text-brand-green'}`}>
            {days === 999 ? '—' : `${days}d remaining`}
          </span>
        </Tooltip>
        <Tooltip tip="Average daily feed consumption over the last 10 days">
          <span className="cursor-default">
            ~{stock.avgDailyUsageKg.toFixed(1)}kg/day
          </span>
        </Tooltip>
      </div>

      {/* LPO suggestion */}
      {isLow && stock.avgDailyUsageKg > 0 && (
        <div className="mt-3 pt-3 border-t border-red-100 dark:border-red-800">
          <Tooltip tip="Recommended order quantity for a 10-day stock cycle">
            <p className="text-xs text-red-600 dark:text-red-400 font-medium cursor-default flex items-center gap-1">
              <FileText className="w-3 h-3" />
              Suggest order: {(stock.avgDailyUsageKg * 10).toFixed(0)}kg
              <Info className="w-3 h-3 opacity-50" />
            </p>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ── Delivery form schema ──────────────────────────────────────────────────────
const deliverySchema = z.object({
  feedType:      z.string().min(1, 'Select feed type'),
  supplierName:  z.string().min(2, 'Supplier name required'),
  quantityKg:    z.coerce.number().positive('Must be positive'),
  pricePerKg:    z.coerce.number().positive('Must be positive'),
  deliveryDate:  z.string().min(1, 'Date required'),
  invoiceNumber: z.string().optional(),
  notes:         z.string().optional(),
});
type DeliveryForm = z.infer<typeof deliverySchema>;

// ── Log Delivery Form ─────────────────────────────────────────────────────────
function DeliveryFormModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<DeliveryForm>({
    resolver: zodResolver(deliverySchema),
    defaultValues: { deliveryDate: dayjs().format('YYYY-MM-DD') },
  });

  const submit = useMutation({
    mutationFn: (data: DeliveryForm) => api.post('/feed/deliveries', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed'] });
      onClose();
    },
  });

  const qty = Number(watch('quantityKg') ?? 0);
  const price = Number(watch('pricePerKg') ?? 0);
  const total = qty * price;

  const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const labelCls = 'block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide';

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl
        shadow-2xl overflow-y-auto max-h-[92vh] md:max-h-[90vh]">

        {/* Modal header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-green rounded-xl flex items-center justify-center">
              <Truck className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Log Feed Delivery</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Record incoming stock</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-4">

          {/* Feed type */}
          <div>
            <label className={labelCls}>Feed Type *</label>
            <select {...register('feedType')} className={inputCls}>
              <option value="">Select feed type...</option>
              {(Object.entries(FEED_LABELS) as [FeedType, any][]).map(([val, cfg]) => (
                <option key={val} value={val}>{cfg.label}</option>
              ))}
            </select>
            {errors.feedType && <p className="text-red-500 text-xs mt-1">{errors.feedType.message}</p>}
          </div>

          {/* Supplier + Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Supplier Name *</label>
              <input {...register('supplierName')} className={inputCls} placeholder="e.g. Unga Feeds Ltd" />
              {errors.supplierName && <p className="text-red-500 text-xs mt-1">{errors.supplierName.message}</p>}
            </div>
            <div>
              <label className={labelCls}>Delivery Date *</label>
              <input {...register('deliveryDate')} type="date" className={inputCls} />
              {errors.deliveryDate && <p className="text-red-500 text-xs mt-1">{errors.deliveryDate.message}</p>}
            </div>
          </div>

          {/* Quantity + Price */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Tooltip tip="Total weight of feed delivered in kilograms">
                <label className={`${labelCls} cursor-default flex items-center gap-1`}>
                  Quantity (kg) * <Info className="w-3 h-3 opacity-40" />
                </label>
              </Tooltip>
              <input {...register('quantityKg')} type="number" step="0.1" min="0" inputMode="decimal"
                className={`${inputCls} text-center text-xl font-bold`} placeholder="0" />
              {errors.quantityKg && <p className="text-red-500 text-xs mt-1">{errors.quantityKg.message}</p>}
            </div>
            <div>
              <Tooltip tip="Cost per kilogram in Kenyan Shillings (KES)">
                <label className={`${labelCls} cursor-default flex items-center gap-1`}>
                  Price/kg (KES) * <Info className="w-3 h-3 opacity-40" />
                </label>
              </Tooltip>
              <input {...register('pricePerKg')} type="number" step="0.01" min="0" inputMode="decimal"
                className={`${inputCls} text-center text-xl font-bold`} placeholder="0" />
              {errors.pricePerKg && <p className="text-red-500 text-xs mt-1">{errors.pricePerKg.message}</p>}
            </div>
          </div>

          {/* Total cost summary */}
          {total > 0 && (
            <div className="bg-brand-green/10 dark:bg-brand-green/20 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-brand-green" />
                <span className="text-sm font-semibold text-brand-green">Total Cost</span>
              </div>
              <span className="text-xl font-bold text-brand-green">
                KES {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Invoice + Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Tooltip tip="Supplier invoice or LPO reference number for record-keeping">
                <label className={`${labelCls} cursor-default flex items-center gap-1`}>
                  Invoice / LPO No. <Info className="w-3 h-3 opacity-40" />
                </label>
              </Tooltip>
              <input {...register('invoiceNumber')} className={inputCls} placeholder="e.g. INV-2026-0042" />
            </div>
            <div>
              <label className={labelCls}>Notes (optional)</label>
              <input {...register('notes')} className={inputCls} placeholder="Any delivery remarks..." />
            </div>
          </div>

          {submit.error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700
              rounded-xl p-3 text-red-700 dark:text-red-400 text-sm">
              {(submit.error as any)?.response?.data?.message ?? 'Failed to log delivery. Please try again.'}
            </div>
          )}

          <button type="submit" disabled={submit.isPending}
            className="w-full bg-brand-green text-white rounded-xl py-4 font-bold text-sm
              hover:bg-brand-mid transition-colors disabled:opacity-60 min-h-[52px]
              flex items-center justify-center gap-2 active:scale-[0.98]">
            {submit.isPending ? 'Logging...' : (
              <><Truck className="w-4 h-4" /> Log Delivery</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Delivery history row ──────────────────────────────────────────────────────
function DeliveryRow({ delivery }: { delivery: any }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = FEED_LABELS[delivery.feedType as FeedType];

  return (
    <div className="bg-white dark:bg-dark-card rounded-xl border border-gray-100 dark:border-dark-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors"
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg?.bg}`}>
          <Package className={`w-4 h-4 ${cfg?.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {cfg?.label ?? delivery.feedType}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {delivery.supplierName} · {dayjs(delivery.deliveryDate).format('D MMM YYYY')}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{Number(delivery.quantityKg).toFixed(0)}kg</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            KES {Number(delivery.totalCost).toLocaleString()}
          </p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-gray-50 dark:border-dark-border">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
            <div className="bg-gray-50 dark:bg-dark-bg rounded-lg p-2">
              <p className="text-gray-400 dark:text-gray-500 mb-0.5">Price/kg</p>
              <p className="font-semibold text-gray-700 dark:text-gray-300">KES {Number(delivery.pricePerKg).toFixed(2)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-dark-bg rounded-lg p-2">
              <p className="text-gray-400 dark:text-gray-500 mb-0.5">Total Cost</p>
              <p className="font-semibold text-gray-700 dark:text-gray-300">KES {Number(delivery.totalCost).toLocaleString()}</p>
            </div>
            {delivery.invoiceNumber && (
              <div className="bg-gray-50 dark:bg-dark-bg rounded-lg p-2">
                <p className="text-gray-400 dark:text-gray-500 mb-0.5">Invoice/LPO</p>
                <p className="font-semibold text-gray-700 dark:text-gray-300 font-mono">{delivery.invoiceNumber}</p>
              </div>
            )}
            <div className="bg-gray-50 dark:bg-dark-bg rounded-lg p-2">
              <p className="text-gray-400 dark:text-gray-500 mb-0.5">Logged</p>
              <p className="font-semibold text-gray-700 dark:text-gray-300">{dayjs(delivery.createdAt).format('D MMM, HH:mm')}</p>
            </div>
          </div>
          {delivery.notes && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-dark-bg rounded-lg p-2">
              {delivery.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main FeedHub page ─────────────────────────────────────────────────────────
export function FeedHub() {
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [showFeedPlanForm, setShowFeedPlanForm] = useState(false);
  const [feedPlanResult, setFeedPlanResult] = useState<any | null>(null);
  const [deliveryDays, setDeliveryDays] = useState(30);

  const { data: stockData, isLoading: stockLoading } = useFeedStock();

  // Low stock alert threshold (days)
  const qc = useQueryClient();

  // Load saved threshold from backend
  const { data: thresholdConfig } = useQuery<{ days: number }>({
    queryKey: ['feed', 'alert-threshold'],
    queryFn: () => api.get('/feed/alert-threshold').then(r => r.data).catch(() => ({ days: 3 })),
    staleTime: 300_000,
  });
  const [alertDays, setAlertDays] = useState(3);
  const [thresholdSaved, setThresholdSaved] = useState(false);

  // Sync local state when backend value loads
  React.useEffect(() => {
    if (thresholdConfig?.days) setAlertDays(thresholdConfig.days);
  }, [thresholdConfig]);

  const updateThreshold = useMutation({
    mutationFn: (days: number) => api.patch('/feed/alert-threshold', { days }).then(r => r.data),
    onSuccess: () => {
      // Refresh stock data (recalculates isLow with new threshold)
      qc.invalidateQueries({ queryKey: ['feed', 'stock'] });
      qc.invalidateQueries({ queryKey: ['feed', 'alert-threshold'] });
      setThresholdSaved(true);
      setTimeout(() => setThresholdSaved(false), 3000);
    },
  });
  const { data: deliveries = [], isLoading: deliveriesLoading } = useQuery({
    queryKey: ['feed', 'deliveries', deliveryDays],
    queryFn: () => api.get(`/feed/deliveries?days=${deliveryDays}`).then(r => r.data),
    staleTime: 60_000,
  });

  const stockEntries = stockData
    ? (Object.entries(stockData) as [FeedType, any][]).filter(([, s]) => s.avgDailyUsageKg > 0 || s.currentStockKg > 0)
    : [];

  const lowCount = stockEntries.filter(([, s]) => s.isLow).length;
  const totalStockKg = stockEntries.reduce((sum, [, s]) => sum + s.currentStockKg, 0);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Feed Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Stock levels · Weekly feed plan · Usage tracking
          </p>
        </div>
        <button
          onClick={() => setShowFeedPlanForm(true)}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2.5
            rounded-xl font-semibold text-sm hover:bg-brand-mid transition-colors
            shadow-sm active:scale-[0.98]"
        >
          <Calendar className="w-4 h-4" />
          Weekly Feed Plan
        </button>
      </div>

      {/* Feed plan saved banner */}
      {feedPlanResult && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border ${
          feedPlanResult.status === 'ATTACHED'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700'
            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700'
        }`}>
          {feedPlanResult.status === 'ATTACHED' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {feedPlanResult.status === 'ATTACHED' && `Feed plan saved and added to issuance plan ${feedPlanResult.planRef} — ${feedPlanResult.dailyKg?.toFixed(2)} kg/day.`}
          {feedPlanResult.status === 'NO_DRAFT_PLAN' && "Feed plan saved. It'll be added automatically once Store creates this week's draft issuance plan."}
          {feedPlanResult.status === 'NO_BIRDS' && 'Feed plan saved, but no active birds were found in that location — nothing was added yet.'}
          {feedPlanResult.status === 'NO_STORE_ITEM' && 'Feed plan saved, but no matching store item was found for this feed type — ask Store to check the catalogue.'}
          {!feedPlanResult.status && 'Feed plan saved.'}
        </div>
      )}

      {/* ── Summary KPIs ── */}
      <div className="grid grid-cols-2 gap-3">
        <Tooltip tip="Total feed across all types currently in stock on the farm">
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 cursor-default">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-4 h-4 text-brand-green" />
              <p className="text-xs text-gray-400 dark:text-gray-500">Total Stock</p>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              {totalStockKg.toFixed(0)}<span className="text-sm font-normal text-gray-400 ml-1">kg</span>
            </p>
          </div>
        </Tooltip>

        <Tooltip tip="Feed types currently below 3-day threshold — order required">
          <div className={`rounded-2xl border p-4 cursor-default ${
            lowCount > 0
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
              : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className={`w-4 h-4 ${lowCount > 0 ? 'text-red-500' : 'text-gray-300'}`} />
              <p className="text-xs text-gray-400 dark:text-gray-500">Low Stock Alerts</p>
            </div>
            <p className={`text-2xl font-bold ${lowCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>
              {lowCount}
            </p>
          </div>
        </Tooltip>

      </div>

      {/* ── Alert Threshold ── */}
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Low Stock Alert Threshold (kg)</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Get notified when any feed type drops below this amount (kg)</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={9999}
            value={alertDays}
            onChange={e => setAlertDays(Number(e.target.value))}
            className="w-16 border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 text-center text-sm font-bold bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
          <span className="text-xs text-gray-400">kg</span>
          <button
            onClick={() => updateThreshold.mutate(alertDays)}
            disabled={updateThreshold.isPending}
            className="px-3 py-2 bg-brand-green text-white rounded-xl text-xs font-semibold hover:bg-brand-mid transition-colors disabled:opacity-60"
          >
            {updateThreshold.isPending ? '...' : thresholdSaved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Stock gauges ── */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Current Stock Levels
        </p>
        {stockLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <div key={i} className="bg-gray-100 dark:bg-dark-card rounded-2xl h-32 animate-pulse" />)}
          </div>
        ) : stockEntries.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border">
            No feed stock data yet. Log your first delivery to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {stockEntries.map(([feedType, stock]) => (
              <StockGauge key={feedType} feedType={feedType} stock={stock} />
            ))}
          </div>
        )}
      </div>

      {/* ── Feed issuance history (current + past weeks, collapsed by default) ── */}
      <BrooderFeedCalendar />

      {/* ── Delivery history ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
              Feed Deliveries & Store Issues
            </p>
            <button
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['feed'] });
              }}
              className="text-[10px] text-brand-green font-semibold hover:underline"
            >
              ↻ Refresh
            </button>
          </div>
          <div className="flex gap-1">
            {[7, 30, 90].map(d => (
              <button
                key={d}
                onClick={() => setDeliveryDays(d)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  deliveryDays === d
                    ? 'bg-brand-green text-white'
                    : 'bg-gray-100 dark:bg-dark-card text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {deliveriesLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="bg-gray-100 dark:bg-dark-card rounded-xl h-14 animate-pulse" />)}
          </div>
        ) : deliveries.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border">
            No deliveries recorded in the last {deliveryDays} days.
          </div>
        ) : (
          <div className="space-y-2">
            {deliveries.map((d: any) => <DeliveryRow key={d.id} delivery={d} />)}
          </div>
        )}
      </div>

      {/* ── Delivery form modal ── */}
      {showDeliveryForm && <DeliveryFormModal onClose={() => setShowDeliveryForm(false)} />}
      {showFeedPlanForm && <WeeklyFeedPlanModal
        onClose={() => setShowFeedPlanForm(false)}
        onSuccess={(planStatus) => { setFeedPlanResult(planStatus ?? {}); setTimeout(() => setFeedPlanResult(null), 8000); }}
      />}
    </div>
  );
}

// ── Weekly Feed Plan Modal (Production Manager) ───────────────────────────────
// Replaces the old feed-request flow entirely. PM picks a feed type + whether
// it's for the brooder or production house, enters grams/bird/day, and the
// system multiplies by the live bird count for that stage. The resulting
// daily kg (and weekly total) is shown immediately, then saved and folded
// into the current week's Issuance Plan as an auto-generated line item.
const PM_FEED_TYPES: { value: FeedType; label: string }[] = [
  { value: 'CHICK_MASH',        label: 'Chick & Duckling Mash' },
  { value: 'GROWER_MASH',       label: "Grower's Mash" },
  { value: 'LAYER_MASH',        label: "Layer's Mash" },
  { value: 'KIENYEJI_STARTER',  label: 'Kienyeji Starter' },
  { value: 'KIENYEJI_GROWER',   label: 'Kienyeji Grower' },
  { value: 'KIENYEJI_FINISHER', label: 'Kienyeji Finisher' },
];

const STAGE_OPTIONS: { value: 'BROODING' | 'PRODUCTION'; label: string }[] = [
  { value: 'BROODING',   label: 'Brooder' },
  { value: 'PRODUCTION', label: 'Production House' },
];

/** Monday of the upcoming week — matches the Saturday Issuance Plan cadence */
function nextMondayDate() {
  const today = dayjs();
  const daysUntilMon = (8 - today.day()) % 7 || 7;
  return today.add(daysUntilMon, 'day').startOf('day');
}

export function WeeklyFeedPlanModal({ onClose, onSuccess }: { onClose: () => void; onSuccess?: (planStatus?: any) => void }) {
  const qc = useQueryClient();
  const weekStart = nextMondayDate();

  const [stage, setStage] = useState<'BROODING' | 'PRODUCTION'>('PRODUCTION');
  const [feedType, setFeedType] = useState<FeedType>('LAYER_MASH');
  const [gramsPerBird, setGramsPerBird] = useState<string>('');

  // Live bird counts per stage, from active batches
  const { data: batches = [] } = useQuery<any[]>({
    queryKey: ['flock', 'batches', { isActive: true }],
    queryFn: () => api.get('/flock/batches', { params: { isActive: true } }).then(r => r.data),
  });

  const birdCount = (batches as any[])
    .filter(b => b.stage === stage)
    .reduce((sum, b) => sum + (b.currentBirdCount ?? 0), 0);

  const grams = Number(gramsPerBird) || 0;
  const dailyKg = (grams * birdCount) / 1000;
  const weeklyKg = dailyKg * 7;

  const submit = useMutation({
    mutationFn: () =>
      api.post('/store/issuance-plans/feed-consumption-plan', {
        weekStartDate: weekStart.format('YYYY-MM-DD'),
        stage,
        feedType,
        gramsPerBirdPerDay: grams,
      }).then(r => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['issuance-plans'] });
      onSuccess?.(data?.planStatus);
      onClose();
    },
  });

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[92vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-teal rounded-xl flex items-center justify-center"><Calendar className="w-4 h-4 text-white" /></div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Weekly Feed Plan</p>
              <p className="text-xs text-gray-400">
                Week of {weekStart.format('D MMM')} – {weekStart.add(6, 'day').format('D MMM YYYY')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Stage toggle */}
          <div>
            <label className={lCls}>Bird Location *</label>
            <div className="grid grid-cols-2 gap-2">
              {STAGE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStage(opt.value)}
                  className={`py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                    stage === opt.value
                      ? 'bg-brand-green text-white border-brand-green'
                      : 'bg-white dark:bg-dark-bg text-gray-600 dark:text-gray-300 border-gray-200 dark:border-dark-border'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {birdCount.toLocaleString()} bird{birdCount !== 1 ? 's' : ''} currently in {stage === 'BROODING' ? 'the brooder' : 'the production house'}
            </p>
          </div>

          {/* Feed type */}
          <div>
            <label className={lCls}>Feed Type *</label>
            <select value={feedType} onChange={e => setFeedType(e.target.value as FeedType)} className={iCls}>
              {PM_FEED_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Grams per bird per day */}
          <div>
            <Tooltip tip="How many grams of this feed each bird eats per day. Multiplied by the live bird count above to calculate daily and weekly totals.">
              <label className={`${lCls} cursor-default flex items-center gap-1`}>
                Grams per Bird per Day * <Info className="w-3 h-3 opacity-40" />
              </label>
            </Tooltip>
            <input
              type="number" step="1" min="0" inputMode="decimal"
              value={gramsPerBird}
              onChange={e => setGramsPerBird(e.target.value)}
              className={`${iCls} text-center text-2xl font-bold`}
              placeholder="0"
            />
          </div>

          {/* Live calculation: daily + weekly total */}
          {grams > 0 && birdCount > 0 && (
            <div className="bg-brand-green/10 dark:bg-brand-green/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-brand-green flex items-center gap-1.5">
                  <Package className="w-4 h-4" /> Per Day
                </span>
                <span className="text-lg font-bold text-brand-green">{dailyKg.toFixed(2)} kg</span>
              </div>
              <div className="flex items-center justify-between border-t border-brand-green/20 pt-2">
                <span className="text-sm font-semibold text-brand-green flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4" /> Week Total (×7 days)
                </span>
                <span className="text-lg font-bold text-brand-green">{weeklyKg.toFixed(2)} kg</span>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {grams}g × {birdCount.toLocaleString()} birds ÷ 1000 = {dailyKg.toFixed(2)} kg/day
              </p>
            </div>
          )}

          {grams > 0 && birdCount === 0 && (
            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              No active birds found in {stage === 'BROODING' ? 'the brooder' : 'the production house'} — this feed line won't be added until there are birds in this stage.
            </div>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500">
            This will be added to the Saturday Issuance Plan as a daily feed line — Store will be alerted each day to issue {dailyKg > 0 ? dailyKg.toFixed(2) + ' kg' : 'the calculated amount'}, and cannot issue more than that day's approved amount.
          </p>

          {submit.isError && (
            <p className="text-red-500 text-sm">
              {(submit.error as any)?.response?.data?.message ?? 'Failed to save feed plan. Please try again.'}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">Cancel</button>
            <button
              type="button"
              onClick={() => submit.mutate()}
              disabled={submit.isPending || grams <= 0 || birdCount === 0}
              className="flex-1 bg-brand-teal text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {submit.isPending ? 'Saving...' : 'Save Feed Plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
