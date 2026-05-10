// src/pages/sales/AdvanceBookingsPage.tsx
// Grade-free. Uses eggType (STANDARD_EGGS / STARTER_EGGS / CONSUMABLE_BROKEN_EGGS).
// Delivery required checkbox + address + date. Price auto-fetched from accountant.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';
import {
  BookOpen, Plus, X, CheckCircle, XCircle, Clock,
  ChevronDown, ChevronUp, Package, AlertCircle, RefreshCw,
} from 'lucide-react';

type EggItemType    = 'STANDARD_EGGS' | 'STARTER_EGGS' | 'CONSUMABLE_BROKEN_EGGS';
type BookingStatus  = 'PENDING' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED';

const EGG_TYPES: { key: EggItemType; label: string }[] = [
  { key: 'STANDARD_EGGS',          label: 'Standard Eggs'          },
  { key: 'STARTER_EGGS',           label: 'Starter Eggs'           },
  { key: 'CONSUMABLE_BROKEN_EGGS', label: 'Consumable Broken Eggs' },
];
const EGG_TYPE_LABELS: Record<EggItemType, string> = {
  STANDARD_EGGS: 'Standard Eggs', STARTER_EGGS: 'Starter Eggs', CONSUMABLE_BROKEN_EGGS: 'Consumable Broken Eggs',
};

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; icon: any }> = {
  PENDING:   { label: 'Pending',   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Clock       },
  CONFIRMED: { label: 'Confirmed', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',     icon: CheckCircle },
  FULFILLED: { label: 'Fulfilled', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle },
  CANCELLED: { label: 'Cancelled', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',        icon: XCircle     },
};
const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green disabled:opacity-60 disabled:cursor-not-allowed';
function fmtKES(n?: number | string | null) { return `KES ${Number(n ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function BookingCard({ booking, onConfirm, onCancel, onFulfill }: {
  booking: any;
  onConfirm: (id: string) => void;
  onCancel: (id: string, reason: string) => void;
  onFulfill: (id: string, deliveryAddress?: string, notes?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showFulfill, setShowFulfill] = useState(false);
  const [fulfillAddr, setFulfillAddr] = useState('');
  const [fulfillNotes, setFulfillNotes] = useState('');
  const statusCfg = STATUS_CONFIG[booking.status as BookingStatus] ?? STATUS_CONFIG.PENDING;
  const StatusIcon = statusCfg.icon;
  const canAct = booking.status === 'PENDING' || booking.status === 'CONFIRMED';
  // Extract egg type from notes
  const notesStr: string = booking.notes ?? '';
  let eggLabel = 'Standard Eggs';
  if      (notesStr.includes('Starter Eggs'))           eggLabel = 'Starter Eggs';
  else if (notesStr.includes('Consumable Broken Eggs')) eggLabel = 'Consumable Broken Eggs';

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
      <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center flex-shrink-0"><BookOpen className="w-5 h-5 text-amber-500" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{booking.bookingRef}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {booking.customer?.name ?? '—'} · {dayjs(booking.requestedDate).format('D MMM YYYY')} · {booking.quantityEggs ?? booking.quantityTrays * 30} eggs · {eggLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{fmtKES(booking.estimatedTotal)}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusCfg.color}`}><StatusIcon className="w-3 h-3 inline mr-1" />{statusCfg.label}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-100 dark:border-dark-border px-4 pb-4 space-y-3 pt-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2"><p className="text-gray-400">Customer</p><p className="font-semibold text-gray-700 dark:text-gray-300">{booking.customer?.name}</p>{booking.customer?.phone && <p className="text-gray-400">{booking.customer.phone}</p>}</div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2"><p className="text-gray-400">Egg Type</p><p className="font-semibold text-gray-700 dark:text-gray-300">{eggLabel}</p></div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2"><p className="text-gray-400">Quantity</p><p className="font-semibold text-gray-700 dark:text-gray-300">{booking.quantityEggs} eggs ({booking.quantityTrays} trays)</p><p className="text-gray-400 mt-0.5">{fmtKES(booking.pricePerEggKes)}/egg</p></div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2"><p className="text-gray-400">Est. Total</p><p className="font-semibold text-brand-green">{fmtKES(booking.estimatedTotal)}</p></div>
          </div>
          {booking.notes && <p className="text-xs text-gray-500 dark:text-gray-400 italic bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2">{booking.notes}</p>}
          {canAct && !showCancel && !showFulfill && (
            <div className="flex flex-wrap gap-2">
              {booking.status === 'PENDING' && <button onClick={() => onConfirm(booking.id)} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"><CheckCircle className="w-3 h-3" /> Confirm Booking</button>}
              {booking.status === 'CONFIRMED' && <button onClick={() => setShowFulfill(true)} className="flex items-center gap-1 bg-brand-green text-white px-3 py-1.5 rounded-lg text-xs font-semibold"><Package className="w-3 h-3" /> Fulfil as Order</button>}
              <button onClick={() => setShowCancel(true)} className="flex items-center gap-1 border border-red-200 text-red-500 px-3 py-1.5 rounded-lg text-xs font-semibold"><XCircle className="w-3 h-3" /> Cancel</button>
            </div>
          )}
          {showCancel && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">Reason for cancellation *</p>
              <textarea rows={2} value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="e.g. Customer changed mind" className={iCls} />
              <div className="flex gap-2">
                <button onClick={() => { if (!cancelReason.trim()) return; onCancel(booking.id, cancelReason); setShowCancel(false); }} className="flex-1 bg-red-500 text-white py-2 rounded-xl text-xs font-semibold">Confirm Cancel</button>
                <button onClick={() => { setShowCancel(false); setCancelReason(''); }} className="px-4 py-2 rounded-xl text-xs border border-gray-200 dark:border-dark-border text-gray-500">Back</button>
              </div>
            </div>
          )}
          {showFulfill && (
            <div className="space-y-2 bg-green-50 dark:bg-green-900/10 rounded-xl p-3">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400">Fulfil → Creates a confirmed sales order</p>
              <div><label className="text-xs text-gray-500 mb-1 block">Delivery Address (if delivering)</label><input value={fulfillAddr} onChange={e => setFulfillAddr(e.target.value)} placeholder="Leave blank if customer collects" className={iCls} /></div>
              <div><label className="text-xs text-gray-500 mb-1 block">Notes</label><input value={fulfillNotes} onChange={e => setFulfillNotes(e.target.value)} className={iCls} /></div>
              <div className="flex gap-2">
                <button onClick={() => { onFulfill(booking.id, fulfillAddr || undefined, fulfillNotes || undefined); setShowFulfill(false); }} className="flex-1 bg-brand-green text-white py-2 rounded-xl text-xs font-semibold">Create Order & Fulfil</button>
                <button onClick={() => setShowFulfill(false)} className="px-4 py-2 rounded-xl text-xs border border-gray-200 dark:border-dark-border text-gray-500">Back</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewBookingModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => api.get('/sales/customers').then(r => r.data) });
  const { data: pricing } = useQuery({ queryKey: ['daily-price-today'], queryFn: () => api.get('/pricing/daily/today').then(r => r.data).catch(() => null) });
  const [form, setForm] = useState({ customerId: '', eggType: 'STANDARD_EGGS' as EggItemType, requestedDate: dayjs().add(1, 'day').format('YYYY-MM-DD'), quantityTrays: 1, quantityEggs: 30, requiresDelivery: false, deliveryAddress: '', deliveryDate: '', notes: '' });

  function getPricePerEgg(et: EggItemType): number {
    if (!pricing) return 0;
    if (et === 'STANDARD_EGGS')          return Number(pricing.pricePerEgg ?? 0);
    if (et === 'STARTER_EGGS')           return Number(pricing.pricePerEggStarter ?? pricing.pricePerEgg ?? 0);
    if (et === 'CONSUMABLE_BROKEN_EGGS') return Number(pricing.pricePerEggBroken  ?? pricing.pricePerEgg ?? 0);
    return 0;
  }
  const peg = getPricePerEgg(form.eggType);
  const qty = form.quantityEggs ?? 30;
  const est = qty * peg;

  const createMutation = useMutation({
    mutationFn: () => api.post('/bookings', { customerId: form.customerId, eggType: form.eggType, requestedDate: form.requestedDate, quantityTrays: Math.max(1, Math.ceil((form.quantityEggs ?? 30) / 30)), requiresDelivery: form.requiresDelivery, deliveryAddress: form.requiresDelivery ? form.deliveryAddress : undefined, deliveryDate: form.requiresDelivery && form.deliveryDate ? form.deliveryDate : undefined, notes: form.notes || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); qc.invalidateQueries({ queryKey: ['sales-stock'] }); onClose(); },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Failed to create booking.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerId) { setError('Please select a customer'); return; }
    if ((form.quantityEggs ?? 0) < 1) { setError('Quantity must be at least 1 egg'); return; }
    if (form.requiresDelivery && !form.deliveryAddress.trim()) { setError('Please enter a delivery address'); return; }
    setError(''); createMutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-dark-card rounded-2xl w-full max-w-lg shadow-2xl my-4">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border">
          <h2 className="font-bold text-gray-800 dark:text-gray-100">New Advance Booking</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="text-xs text-gray-500 mb-1 block">Customer *</label>
            <select value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} className={iCls} required>
              <option value="">— Select customer —</option>
              {(customers as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-500 mb-2 block">Egg Category *</label>
            <div className="flex flex-wrap gap-2">
              {EGG_TYPES.map(g => (
                <button key={g.key} type="button" onClick={() => setForm(f => ({ ...f, eggType: g.key }))}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${form.eggType === g.key ? 'bg-brand-green text-white border-brand-green' : 'bg-white dark:bg-dark-bg text-gray-600 dark:text-gray-400 border-gray-200 dark:border-dark-border'}`}>
                  {g.label}
                </button>
              ))}
            </div></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs text-gray-500 mb-1 block">Eggs *</label><input type="number" min="1" step="1" value={form.quantityEggs ?? 30} onChange={e => setForm(f => ({ ...f, quantityEggs: Math.max(1, parseInt(e.target.value) || 1) }))} className={iCls} /><p className="text-xs text-gray-400 mt-1">{Math.max(1, Math.ceil((form.quantityEggs ?? 30) / 30))} trays</p></div>
            <div><label className="text-xs text-gray-500 mb-1 block">Requested Date *</label><input type="date" value={form.requestedDate} onChange={e => setForm(f => ({ ...f, requestedDate: e.target.value }))} className={iCls} min={dayjs().format('YYYY-MM-DD')} required /></div>
          </div>
          {pricing ? (
            <div className="bg-brand-green/5 border border-brand-green/20 rounded-xl p-3 text-xs space-y-1">
              <p className="font-semibold text-brand-green">Pricing (accountant · read-only)</p>
              <p className="text-gray-600 dark:text-gray-400">KES <strong>{peg.toFixed(2)}</strong>/egg · Estimated total: <strong className="text-brand-green">{fmtKES(est)}</strong></p>
            </div>
          ) : (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" /><span>No pricing today — estimate saved as KES 0. Confirmed at fulfilment.</span>
            </div>
          )}
          <div><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.requiresDelivery} onChange={e => setForm(f => ({ ...f, requiresDelivery: e.target.checked }))} className="w-4 h-4 rounded accent-brand-green" /><span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Delivery Required</span></label>
            {form.requiresDelivery && (
              <div className="mt-3 space-y-3 pl-6">
                <div><label className="text-xs text-gray-500 mb-1 block">Delivery Address *</label><input type="text" value={form.deliveryAddress} onChange={e => setForm(f => ({ ...f, deliveryAddress: e.target.value }))} placeholder="e.g. Emali Town, Shop 3" className={iCls} /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">Delivery Date</label><input type="date" value={form.deliveryDate} onChange={e => setForm(f => ({ ...f, deliveryDate: e.target.value }))} className={iCls} /></div>
              </div>
            )}
          </div>
          <div><label className="text-xs text-gray-500 mb-1 block">Notes (optional)</label><textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={iCls} placeholder="Special instructions..." /></div>
          {error && <p className="text-xs text-red-600 flex items-center gap-1 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-xl"><AlertCircle className="w-3 h-3" /> {error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={createMutation.isPending} className="flex-1 bg-brand-green text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
              {createMutation.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}{createMutation.isPending ? 'Saving…' : 'Lock Stock & Save'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm border border-gray-200 dark:border-dark-border text-gray-500">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdvanceBookingsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<BookingStatus | ''>('');
  const { data: bookings = [], isLoading } = useQuery({ queryKey: ['bookings', statusFilter], queryFn: () => api.get(`/bookings${statusFilter ? `?status=${statusFilter}` : ''}`).then(r => r.data), staleTime: 30_000 });
  const { data: lockedStock } = useQuery({ queryKey: ['locked-stock'], queryFn: () => api.get('/bookings/locked-stock').then(r => r.data).catch(() => null), staleTime: 60_000 });
  const confirmMutation = useMutation({ mutationFn: (id: string) => api.patch(`/bookings/${id}/confirm`), onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }) });
  const cancelMutation  = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.patch(`/bookings/${id}/cancel`, { cancellationReason: reason }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); qc.invalidateQueries({ queryKey: ['sales-stock'] }); } });
  const fulfillMutation = useMutation({ mutationFn: ({ id, deliveryAddress, notes }: { id: string; deliveryAddress?: string; notes?: string }) => api.patch(`/bookings/${id}/fulfill`, { deliveryAddress, notes }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); qc.invalidateQueries({ queryKey: ['sales-orders'] }); qc.invalidateQueries({ queryKey: ['sales-summary'] }); qc.invalidateQueries({ queryKey: ['sales-stock'] }); } });

  const filters: { label: string; value: BookingStatus | '' }[] = [
    { label: 'All', value: '' }, { label: 'Pending', value: 'PENDING' }, { label: 'Confirmed', value: 'CONFIRMED' }, { label: 'Fulfilled', value: 'FULFILLED' }, { label: 'Cancelled', value: 'CANCELLED' },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2"><BookOpen className="w-5 h-5 text-amber-500" /> Advance Bookings</h1><p className="text-xs text-gray-400 mt-0.5">Lock stock for customers in advance. Fulfil as an order when ready.</p></div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-xl text-sm font-semibold"><Plus className="w-4 h-4" /> New Booking</button>
      </div>
      {lockedStock && lockedStock.totalLockedTrays > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 uppercase tracking-wider">Locked Stock</p>
          <p className="text-sm text-amber-800 dark:text-amber-300"><strong>{lockedStock.totalLockedTrays}</strong> trays ({lockedStock.totalLockedEggs} eggs) reserved across <strong>{lockedStock.activeBookings?.length ?? 0}</strong> active booking{lockedStock.activeBookings?.length !== 1 ? 's' : ''}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {filters.map(({ label, value }) => (
          <button key={value} onClick={() => setStatusFilter(value)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${statusFilter === value ? 'bg-amber-500 text-white' : 'bg-white dark:bg-dark-card text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-dark-border'}`}>
            {label}
          </button>
        ))}
      </div>
      {isLoading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-gray-100 dark:bg-dark-card rounded-2xl h-16 animate-pulse" />)}</div>
        : (bookings as any[]).length === 0 ? (
          <div className="text-center py-14 text-gray-400 bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border">
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" /><p className="font-semibold">No bookings found</p><p className="text-sm mt-1">Create a booking to reserve stock for a customer in advance.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(bookings as any[]).map((b: any) => (
              <BookingCard key={b.id} booking={b}
                onConfirm={id => confirmMutation.mutate(id)}
                onCancel={(id, reason) => cancelMutation.mutate({ id, reason })}
                onFulfill={(id, da, n) => fulfillMutation.mutate({ id, deliveryAddress: da, notes: n })} />
            ))}
          </div>
        )}
      {showForm && <NewBookingModal onClose={() => setShowForm(false)} />}
    </div>
  );
}
