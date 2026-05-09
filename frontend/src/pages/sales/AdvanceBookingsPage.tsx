// src/pages/sales/AdvanceBookingsPage.tsx
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Plus, Lock, XCircle, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 text-base bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green disabled:opacity-60 disabled:bg-gray-50 dark:disabled:bg-gray-800';
const cCls = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';

function eggsToTrays(eggs: number): string {
  if (!eggs || eggs <= 0) return '0 trays';
  const trays = Math.floor(eggs / 30);
  const remainder = eggs % 30;
  if (trays === 0) return `${remainder} eggs`;
  if (remainder === 0) return `${trays} trays`;
  return `${trays} trays + ${remainder} eggs`;
}

const STATUS_COLOURS: Record<string, string> = {
  PENDING:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  CONFIRMED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  FULFILLED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  CANCELLED: 'bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400',
};

// Egg category rows config
const EGG_CATEGORIES = [
  { key: 'qtyNormal',         label: 'Normal Eggs',          priceKey: 'standardPriceKes',  fallbackKey: 'pricePerEggProduction', color: 'text-brand-green' },
  { key: 'qtyStarter',        label: 'Starter Eggs',         priceKey: 'starterPriceKes',   fallbackKey: null,                   color: 'text-blue-500'   },
  { key: 'qtyBrokenSellable', label: 'Broken Sellable Eggs', priceKey: 'consumablePriceKes',fallbackKey: null,                   color: 'text-amber-500'  },
] as const;

type EggCategoryKey = 'qtyNormal' | 'qtyStarter' | 'qtyBrokenSellable';

type FormData = {
  customerId: string;
  requestedDate: string;
  notes: string;
  qtyNormal: number;
  qtyStarter: number;
  qtyBrokenSellable: number;
};

export function AdvanceBookingsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm]           = useState(false);
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  const [cancelId, setCancelId]           = useState<string | null>(null);
  const [cancelReason, setCancelReason]   = useState('');
  const [fulfillId, setFulfillId]         = useState<string | null>(null);
  const [fulfillBooking, setFulfillBooking] = useState<any>(null);
  const [fulfillAddress, setFulfillAddress] = useState('');
  const [fulfillNotes, setFulfillNotes]   = useState('');
  const [statusFilter, setStatusFilter]   = useState('');

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['bookings', statusFilter],
    queryFn: () => api.get(`/bookings${statusFilter ? `?status=${statusFilter}` : ''}`).then(r => r.data),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get('/sales/customers').then(r => r.data),
  });

  const { data: todayPrice } = useQuery({
    queryKey: ['daily-price', 'today'],
    queryFn: () => api.get('/pricing/daily/today').then(r => r.data).catch(() => null),
  });

  const { register, handleSubmit, watch, reset } = useForm<FormData>({
    defaultValues: {
      customerId:      '',
      requestedDate:   dayjs().add(2, 'day').format('YYYY-MM-DD'),
      notes:           '',
      qtyNormal:       0,
      qtyStarter:      0,
      qtyBrokenSellable: 0,
    },
  });

  // Helper: resolve price for a category
  const getPrice = (priceKey: string, fallbackKey: string | null): number => {
    if (!todayPrice) return 0;
    return Number(todayPrice[priceKey] ?? (fallbackKey ? todayPrice[fallbackKey] : 0) ?? 0);
  };

  const qtyNormal        = Number(watch('qtyNormal')        || 0);
  const qtyStarter       = Number(watch('qtyStarter')       || 0);
  const qtyBrokenSellable = Number(watch('qtyBrokenSellable') || 0);
  const totalEggs        = qtyNormal + qtyStarter + qtyBrokenSellable;

  const estimatedTotal =
    qtyNormal        * getPrice('standardPriceKes',  'pricePerEggProduction') +
    qtyStarter       * getPrice('starterPriceKes',   null)                   +
    qtyBrokenSellable * getPrice('consumablePriceKes', null);

  const create = useMutation({
    mutationFn: (d: FormData) => {
      const items = [
        ...(d.qtyNormal > 0        ? [{ eggType: 'STANDARD',          quantity: Number(d.qtyNormal),        unitPrice: getPrice('standardPriceKes',  'pricePerEggProduction') }] : []),
        ...(d.qtyStarter > 0       ? [{ eggType: 'STARTER',           quantity: Number(d.qtyStarter),       unitPrice: getPrice('starterPriceKes',   null)                   }] : []),
        ...(d.qtyBrokenSellable > 0 ? [{ eggType: 'CONSUMABLE_BROKEN', quantity: Number(d.qtyBrokenSellable), unitPrice: getPrice('consumablePriceKes', null)                 }] : []),
      ];
      return api.post('/bookings', {
        customerId:    d.customerId,
        requestedDate: d.requestedDate,
        quantityEggs:  totalEggs,
        quantityTrays: Math.floor(totalEggs / 30),
        notes:         d.notes || undefined,
        items,
      }).then(r => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      setShowForm(false);
      reset();
    },
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/bookings/${id}/cancel`, { cancellationReason: reason }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      setCancelId(null);
      setCancelReason('');
    },
  });

  const confirm = useMutation({
    mutationFn: (id: string) => api.patch(`/bookings/${id}/confirm`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });

  const fulfill = useMutation({
    mutationFn: ({ id, deliveryAddress, notes }: { id: string; deliveryAddress?: string; notes?: string }) =>
      api.patch(`/bookings/${id}/fulfill`, { deliveryAddress, notes }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      setFulfillId(null);
      setFulfillBooking(null);
      setFulfillAddress('');
      setFulfillNotes('');
    },
  });

  const lockedTotal = (bookings as any[])
    .filter((b: any) => b.stockLocked)
    .reduce((s: number, b: any) => s + b.quantityEggs, 0);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-brand-green" /> Advance Bookings
          </h1>
          {lockedTotal > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1 mt-1">
              <Lock className="w-3 h-3" /> {lockedTotal} eggs ({eggsToTrays(lockedTotal)}) currently locked
            </p>
          )}
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-brand-green text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-green-800 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Booking
        </button>
      </div>

      {/* Today's pricing banner — shows all 3 categories */}
      {todayPrice ? (
        <div className="mb-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-2">
            Today's Prices — set by Accountant on {dayjs(todayPrice.pricingDate).format('D MMM YYYY')}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {EGG_CATEGORIES.map(({ label, priceKey, fallbackKey, color }) => {
              const price = getPrice(priceKey, fallbackKey);
              return (
                <div key={priceKey} className="text-center">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className={`text-sm font-bold ${color}`}>KES {price.toFixed(2)}</p>
                  <p className="text-xs text-gray-400">per egg</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          No price set for today — bookings cannot be created until the Accountant sets pricing.
        </div>
      )}

      {/* New booking form */}
      {showForm && (
        <div className={`${cCls} mb-5`}>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4">New Advance Booking</h2>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Customer *</label>
                <select {...register('customerId', { required: true })} className={iCls}>
                  <option value="">Select customer...</option>
                  {(customers as any[]).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Delivery Date *</label>
                <input {...register('requestedDate', { required: true })} type="date" className={iCls} />
              </div>
            </div>

            {/* Egg Categories — price auto-generated, no manual entry */}
            <div>
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-2">
                Egg Categories <span className="text-xs font-normal text-gray-400">(prices set by Accountant — not editable)</span>
              </p>
              {!todayPrice && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                  Prices not yet set. Contact Accountant before creating a booking.
                </p>
              )}
              <div className="space-y-2">
                {EGG_CATEGORIES.map(({ key, label, priceKey, fallbackKey, color }) => {
                  const price = getPrice(priceKey, fallbackKey);
                  const qty   = Number(watch(key as EggCategoryKey) || 0);
                  return (
                    <div key={key} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                      <div className="flex-1">
                        <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                        <input
                          type="number"
                          min="0"
                          {...register(key as EggCategoryKey, { min: 0, valueAsNumber: true })}
                          disabled={!todayPrice}
                          className={iCls}
                          placeholder="0"
                        />
                        {qty > 0 && (
                          <p className="text-xs text-gray-400 mt-0.5">{eggsToTrays(qty)}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0 min-w-[80px]">
                        <p className="text-xs text-gray-400">Price/egg</p>
                        <p className={`text-sm font-bold ${color}`}>
                          KES {price.toFixed(2)}
                        </p>
                        {qty > 0 && price > 0 && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            = KES {(qty * price).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Estimated total summary */}
            {totalEggs > 0 && estimatedTotal > 0 && (
              <div className="bg-brand-green/10 rounded-xl p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="text-gray-600 dark:text-gray-300 text-xs">Total eggs</p>
                  <p className="font-semibold text-gray-800 dark:text-gray-100">{totalEggs} eggs ({eggsToTrays(totalEggs)})</p>
                </div>
                <div className="text-right">
                  <p className="text-gray-600 dark:text-gray-300 text-xs">Estimated total</p>
                  <p className="font-bold text-brand-green">
                    KES {estimatedTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
              <input {...register('notes')} className={iCls} placeholder="e.g. Weekly regular order" />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-200 dark:border-dark-border rounded-xl py-3 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-bg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={create.isPending || !todayPrice || totalEggs === 0}
                className="flex-1 bg-brand-green text-white rounded-xl py-3 text-sm font-bold disabled:opacity-60 hover:bg-green-800"
              >
                {create.isPending ? 'Locking...' : 'Lock Stock & Save →'}
              </button>
            </div>
            {create.isError && (
              <p className="text-red-500 text-sm">
                {(create.error as any)?.response?.data?.message ?? 'Failed to create booking.'}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {['', 'PENDING', 'CONFIRMED', 'FULFILLED', 'CANCELLED'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              statusFilter === s
                ? 'bg-brand-green text-white'
                : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-300 hover:bg-gray-200'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Bookings list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (bookings as any[]).length === 0 ? (
        <div className={`${cCls} text-center py-10 text-gray-400`}>
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No bookings found.
        </div>
      ) : (
        <div className="space-y-3">
          {(bookings as any[]).map((b: any) => (
            <div key={b.id} className={cCls}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-gray-500">{b.bookingRef}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLOURS[b.status]}`}>
                      {b.status}
                    </span>
                    {b.stockLocked && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                        <Lock className="w-3 h-3" /> Locked
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-gray-800 dark:text-gray-100 mt-1">{b.customer?.name}</p>
                  <p className="text-sm text-gray-500">
                    {b.quantityEggs} eggs ({eggsToTrays(b.quantityEggs)}) · {dayjs(b.requestedDate).format('D MMM YYYY')}
                  </p>
                  {/* Show categorised breakdown if available */}
                  {b.items?.length > 0 && (
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {(b.items as any[]).map((item: any) => (
                        <span key={item.id ?? item.eggType} className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full text-gray-500">
                          {item.eggType === 'STANDARD' ? 'Normal' : item.eggType === 'STARTER' ? 'Starter' : 'Broken Sellable'}: {item.quantity}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-sm font-medium text-brand-green mt-0.5">
                    Est. KES {Number(b.estimatedTotal).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  {b.status === 'PENDING' && (
                    <button
                      onClick={() => confirm.mutate(b.id)}
                      className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg px-2 py-1 font-semibold hover:bg-blue-100"
                    >
                      Confirm
                    </button>
                  )}
                  {b.status === 'CONFIRMED' && (
                    <button
                      onClick={() => { setFulfillId(b.id); setFulfillBooking(b); }}
                      className="text-xs bg-green-50 dark:bg-green-900/20 text-brand-green rounded-lg px-2 py-1 font-semibold hover:bg-green-100"
                    >
                      Fulfill
                    </button>
                  )}
                  {(b.status === 'PENDING' || b.status === 'CONFIRMED') && (
                    <button
                      onClick={() => setCancelId(b.id)}
                      className="text-xs bg-red-50 dark:bg-red-900/20 text-red-500 rounded-lg px-2 py-1 font-semibold hover:bg-red-100"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={() => setExpandedId(v => v === b.id ? null : b.id)}
                    className="p-1 text-gray-400 hover:text-gray-600"
                  >
                    {expandedId === b.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {expandedId === b.id && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-dark-border text-sm space-y-1 text-gray-600 dark:text-gray-400">
                  <p>Total eggs: <strong>{b.quantityEggs}</strong> ({eggsToTrays(b.quantityEggs)})</p>
                  {b.items?.length > 0 && (
                    <div className="space-y-0.5">
                      {(b.items as any[]).map((item: any) => (
                        <p key={item.id ?? item.eggType}>
                          {item.eggType === 'STANDARD' ? 'Normal' : item.eggType === 'STARTER' ? 'Starter' : 'Broken Sellable'}:&nbsp;
                          <strong>{item.quantity}</strong> eggs @ KES {Number(item.unitPrice).toFixed(2)}/egg
                          = <strong>KES {Number(item.quantity * item.unitPrice).toLocaleString()}</strong>
                        </p>
                      ))}
                    </div>
                  )}
                  <p>Booked: {dayjs(b.bookingDate).format('D MMM YYYY HH:mm')}</p>
                  {b.notes && <p>Notes: {b.notes}</p>}
                  {b.cancellationReason && (
                    <p className="text-red-500">Cancellation reason: {b.cancellationReason}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Fulfill modal */}
      {fulfillId && fulfillBooking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-dark-card rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-1">Fulfill Booking</h3>
            <p className="text-sm text-gray-500 mb-1">
              This will create a <strong>Sales Order</strong> and release the locked stock.
            </p>
            <div className="bg-brand-green/10 rounded-xl p-3 mb-4 text-sm">
              <p className="font-semibold text-gray-800 dark:text-gray-100">{fulfillBooking.customer?.name}</p>
              <p className="text-gray-500">{fulfillBooking.quantityEggs} eggs · {eggsToTrays(fulfillBooking.quantityEggs)}</p>
              <p className="text-brand-green font-semibold">KES {Number(fulfillBooking.estimatedTotal).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Delivery Address (optional)</label>
                <input
                  value={fulfillAddress}
                  onChange={e => setFulfillAddress(e.target.value)}
                  placeholder="e.g. Nairobi CBD, Emali..."
                  className={iCls}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notes (optional)</label>
                <input
                  value={fulfillNotes}
                  onChange={e => setFulfillNotes(e.target.value)}
                  placeholder="Any delivery notes..."
                  className={iCls}
                />
              </div>
            </div>
            {fulfill.isError && (
              <p className="text-red-500 text-xs mb-3">
                {(fulfill.error as any)?.response?.data?.message ?? 'Failed to fulfill booking.'}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setFulfillId(null); setFulfillBooking(null); setFulfillAddress(''); setFulfillNotes(''); }}
                className="flex-1 border border-gray-200 dark:border-dark-border rounded-xl py-2.5 text-sm font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => fulfill.mutate({ id: fulfillId, deliveryAddress: fulfillAddress || undefined, notes: fulfillNotes || undefined })}
                disabled={fulfill.isPending}
                className="flex-1 bg-brand-green text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-60"
              >
                {fulfill.isPending ? 'Creating Order...' : 'Create Sales Order →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {cancelId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-dark-card rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-1">Cancel Booking</h3>
            <p className="text-sm text-gray-500 mb-4">
              Cancelling will release the locked stock. This cannot be undone.
            </p>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Reason for cancellation..."
              className={iCls}
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setCancelId(null); setCancelReason(''); }}
                className="flex-1 border border-gray-200 dark:border-dark-border rounded-xl py-2.5 text-sm font-semibold text-gray-600"
              >
                Keep Booking
              </button>
              <button
                onClick={() => cancel.mutate({ id: cancelId!, reason: cancelReason })}
                disabled={!cancelReason.trim() || cancel.isPending}
                className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-60"
              >
                {cancel.isPending ? 'Cancelling...' : 'Cancel Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
