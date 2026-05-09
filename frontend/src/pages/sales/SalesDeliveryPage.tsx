// src/pages/sales/SalesDeliveryPage.tsx — NEW
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, CheckCircle, Phone, MapPin, Package, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';

const STATUS_COLORS: Record<string, string> = {
  DELIVERING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  DELIVERED:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

function fmtKES(n: number | string) { return `KES ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }

export default function SalesDeliveryPage() {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmNotes, setConfirmNotes] = useState('');

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['delivery-orders'],
    queryFn: () => api.get('/sales/orders?status=DELIVERING&days=90').then(r => r.data),
    refetchInterval: 60_000,
  });

  const markDelivered = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) => api.patch(`/sales/orders/${id}/deliver`, { notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-orders'] }); setConfirmId(null); setConfirmNotes(''); },
  });

  const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2"><Truck className="w-5 h-5 text-brand-green" /> Delivery Tracking</h1>
        <p className="text-xs text-gray-400 mt-0.5">Orders currently out for delivery. Mark as delivered once customer confirms receipt.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border text-center">
          <p className="text-2xl font-bold text-blue-500">{(orders as any[]).length}</p>
          <p className="text-xs text-gray-400 mt-0.5">In Transit</p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border text-center">
          <p className="text-2xl font-bold text-brand-green">{fmtKES((orders as any[]).reduce((s: number, o: any) => s + (Number(o.subtotal) || 0), 0))}</p>
          <p className="text-xs text-gray-400 mt-0.5">Total Value in Transit</p>
        </div>
      </div>
      {isLoading ? <p className="text-sm text-gray-400 text-center py-8">Loading deliveries\u2026</p>
      : (orders as any[]).length === 0 ? (
        <div className="bg-white dark:bg-dark-card rounded-2xl p-8 border border-gray-100 dark:border-dark-border text-center">
          <Truck className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">No orders currently out for delivery</p>
          <p className="text-xs text-gray-400 mt-1">Orders marked as "Delivering" will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(orders as any[]).map((order: any) => {
            const isExpanded = expandedId === order.id;
            const isConfirming = confirmId === order.id;
            return (
              <div key={order.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
                <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : order.id)}>
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0"><Truck className="w-5 h-5 text-blue-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{order.orderNumber}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{order.customer?.name ?? '\u2014'} \u00b7 {dayjs(order.orderDate).format('D MMM YYYY')}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[order.status] ?? ''}`}>{order.status}</span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-dark-border px-4 pb-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
                      {order.customer?.phone && <div className="flex items-center gap-2 text-sm"><Phone className="w-4 h-4 text-gray-400 flex-shrink-0" /><span className="text-gray-700 dark:text-gray-300">{order.customer.phone}</span></div>}
                      {order.deliveryAddress && <div className="flex items-start gap-2 text-sm"><MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" /><span className="text-gray-700 dark:text-gray-300">{order.deliveryAddress}</span></div>}
                    </div>
                    {order.items?.length > 0 && (
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-1">
                        {order.items.map((item: any) => (
                          <div key={item.id} className="flex justify-between text-xs">
                            <span className="text-gray-600 dark:text-gray-400"><Package className="w-3 h-3 inline mr-1" />{item.grade ?? item.itemType} \u00b7 {item.quantityTrays ?? 0} trays</span>
                            <span className="font-semibold text-gray-700 dark:text-gray-300">KES {Number(item.subtotal ?? 0).toLocaleString()}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs font-bold border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
                          <span className="text-gray-700 dark:text-gray-300">Total</span>
                          <span className="text-brand-green">{fmtKES(order.subtotal ?? 0)}</span>
                        </div>
                      </div>
                    )}
                    {!isConfirming ? (
                      <button onClick={() => setConfirmId(order.id)} className="w-full flex items-center justify-center gap-2 bg-brand-green text-white py-2.5 rounded-xl text-sm font-semibold"><CheckCircle className="w-4 h-4" /> Mark as Delivered</button>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-xs text-gray-500 block">Delivery notes (optional)</label>
                        <input value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)} placeholder="e.g. Received by John at gate" className={inputCls} />
                        <div className="flex gap-2">
                          <button onClick={() => markDelivered.mutate({ id: order.id, notes: confirmNotes })} disabled={markDelivered.isPending} className="flex-1 bg-brand-green text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-60">{markDelivered.isPending ? 'Confirming\u2026' : 'Confirm Delivery'}</button>
                          <button onClick={() => { setConfirmId(null); setConfirmNotes(''); }} className="px-4 py-2 rounded-xl text-sm border border-gray-200 dark:border-dark-border text-gray-500">Cancel</button>
                        </div>
                        {markDelivered.isError && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Failed to confirm.</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
