// src/pages/sales/SalesDeliveryPage.tsx
// Grade-free. Displays item.itemType (STANDARD_EGGS etc.) with human labels.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, CheckCircle, Phone, MapPin, Package, AlertCircle, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';

type EggItemType = 'STANDARD_EGGS' | 'STARTER_EGGS' | 'CONSUMABLE_BROKEN_EGGS';
const EGG_TYPE_LABELS: Record<string, string> = {
  STANDARD_EGGS:          'Standard Eggs',
  STARTER_EGGS:           'Starter Eggs',
  CONSUMABLE_BROKEN_EGGS: 'Consumable Broken Eggs',
};

function fmtKES(n?: number | string | null) {
  return `KES ${Number(n ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';

export default function SalesDeliveryPage() {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliverNotes, setDeliverNotes] = useState('');
  const [confirmDeliverId, setConfirmDeliverId] = useState<string | null>(null);

  const { data: confirmedOrders = [], isLoading: loadingConfirmed } = useQuery({
    queryKey: ['delivery-confirmed'],
    queryFn: () => api.get('/sales/orders?status=CONFIRMED&days=60').then(r => (r.data as any[]).filter((o: any) => !!o.deliveryAddress)),
    refetchInterval: 60_000,
  });

  const { data: deliveringOrders = [], isLoading: loadingDelivering } = useQuery({
    queryKey: ['delivery-delivering'],
    queryFn: () => api.get('/sales/orders?status=DELIVERING&days=90').then(r => r.data),
    refetchInterval: 30_000,
  });

  const markDelivering = useMutation({
    mutationFn: (id: string) => api.patch(`/sales/orders/${id}/delivering`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-confirmed'] }); qc.invalidateQueries({ queryKey: ['delivery-delivering'] }); },
  });
  const markDelivered = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) => api.patch(`/sales/orders/${id}/deliver`, { notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-delivering'] }); qc.invalidateQueries({ queryKey: ['sales-summary'] }); setConfirmDeliverId(null); setDeliverNotes(''); },
  });

  const inTransitValue = (deliveringOrders as any[]).reduce((s: number, o: any) => s + Number(o.subtotal ?? 0), 0);

  function OrderRow({ order, mode }: { order: any; mode: 'ready' | 'transit' }) {
    const isExpanded  = expandedId === order.id;
    const isConfirming = confirmDeliverId === order.id;
    return (
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : order.id)}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${mode === 'transit' ? 'bg-indigo-100 dark:bg-indigo-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
            <Truck className={`w-5 h-5 ${mode === 'transit' ? 'text-indigo-500' : 'text-blue-500'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{order.orderNumber}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {order.customer?.name ?? '—'} · {dayjs(order.orderDate).format('D MMM YYYY')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${mode === 'transit' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
              {mode === 'transit' ? 'In Transit' : 'Ready to Dispatch'}
            </span>
            {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </div>
        {isExpanded && (
          <div className="border-t border-gray-100 dark:border-dark-border px-4 pb-4 space-y-3 pt-3">
            {order.customer?.phone && <div className="flex items-center gap-2 text-sm"><Phone className="w-4 h-4 text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-300">{order.customer.phone}</span></div>}
            {order.deliveryAddress && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="text-gray-700 dark:text-gray-300">{order.deliveryAddress}</span>
                  {order.deliveryDate && <p className="text-xs text-gray-400 mt-0.5"><Clock className="w-3 h-3 inline mr-1" />Scheduled: {dayjs(order.deliveryDate).format('D MMM YYYY')}</p>}
                </div>
              </div>
            )}
            {(order.items ?? []).length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-1">
                {(order.items ?? []).map((item: any) => (
                  <div key={item.id} className="flex justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400">
                      <Package className="w-3 h-3 inline mr-1" />
                      {EGG_TYPE_LABELS[item.itemType] ?? item.itemType} · {item.quantityTrays ?? 0} trays
                    </span>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">{fmtKES(item.subtotal)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs font-bold border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
                  <span>Total</span><span className="text-brand-green">{fmtKES(order.subtotal)}</span>
                </div>
              </div>
            )}
            {mode === 'ready' && (
              <button onClick={() => markDelivering.mutate(order.id)} disabled={markDelivering.isPending}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60">
                <Truck className="w-4 h-4" /> Mark as Out for Delivery
              </button>
            )}
            {mode === 'transit' && (
              isConfirming ? (
                <div className="space-y-2">
                  <label className="text-xs text-gray-500 block">Delivery notes (optional)</label>
                  <input value={deliverNotes} onChange={e => setDeliverNotes(e.target.value)} placeholder="e.g. Received by owner at gate" className={iCls} />
                  <div className="flex gap-2">
                    <button onClick={() => markDelivered.mutate({ id: order.id, notes: deliverNotes })} disabled={markDelivered.isPending}
                      className="flex-1 bg-brand-green text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
                      {markDelivered.isPending ? 'Confirming…' : 'Confirm Delivered'}
                    </button>
                    <button onClick={() => { setConfirmDeliverId(null); setDeliverNotes(''); }} className="px-4 py-2 rounded-xl text-sm border border-gray-200 dark:border-dark-border text-gray-500">Cancel</button>
                  </div>
                  {markDelivered.isError && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Failed.</p>}
                </div>
              ) : (
                <button onClick={() => setConfirmDeliverId(order.id)}
                  className="w-full flex items-center justify-center gap-2 bg-brand-green text-white py-2.5 rounded-xl text-sm font-semibold">
                  <CheckCircle className="w-4 h-4" /> Customer Received — Mark as Delivered
                </button>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  const isLoading = loadingConfirmed || loadingDelivering;
  return (
    <div className="p-4 md:p-8 space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2"><Truck className="w-5 h-5 text-brand-green" /> Delivery Tracking</h1>
        <p className="text-xs text-gray-400 mt-0.5">Dispatch confirmed orders and confirm deliveries to customers.</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border text-center"><p className="text-xl font-bold text-blue-500">{(confirmedOrders as any[]).length}</p><p className="text-xs text-gray-400 mt-0.5">Ready to Dispatch</p></div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border text-center"><p className="text-xl font-bold text-indigo-500">{(deliveringOrders as any[]).length}</p><p className="text-xs text-gray-400 mt-0.5">In Transit</p></div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border text-center"><p className="text-lg font-bold text-brand-green">{fmtKES(inTransitValue)}</p><p className="text-xs text-gray-400 mt-0.5">In-Transit Value</p></div>
      </div>
      {isLoading ? <p className="text-sm text-gray-400 text-center py-8">Loading…</p> : (
        <>
          {(confirmedOrders as any[]).length > 0 && (
            <div><p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Ready to Dispatch ({(confirmedOrders as any[]).length})</p>
              <div className="space-y-3">{(confirmedOrders as any[]).map((o: any) => <OrderRow key={o.id} order={o} mode="ready" />)}</div></div>
          )}
          {(deliveringOrders as any[]).length > 0 && (
            <div><p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Currently in Transit ({(deliveringOrders as any[]).length})</p>
              <div className="space-y-3">{(deliveringOrders as any[]).map((o: any) => <OrderRow key={o.id} order={o} mode="transit" />)}</div></div>
          )}
          {(confirmedOrders as any[]).length === 0 && (deliveringOrders as any[]).length === 0 && (
            <div className="bg-white dark:bg-dark-card rounded-2xl p-8 border border-gray-100 dark:border-dark-border text-center">
              <Truck className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500">No deliveries right now</p>
              <p className="text-xs text-gray-400 mt-1">Confirmed orders with a delivery address will appear here</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
