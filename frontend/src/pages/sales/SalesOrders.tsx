// src/pages/sales/SalesOrders.tsx
// Grade-free version: egg category stored as itemType (STANDARD_EGGS / STARTER_EGGS /
// CONSUMABLE_BROKEN_EGGS). No grade field anywhere. Prices auto-enforced from accountant.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';
import {
  ShoppingCart, Plus, X, ChevronDown, ChevronUp, CheckCircle, Clock,
  XCircle, Truck, Package, AlertCircle, TrendingUp, Trash2,
  MapPin, RefreshCw,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────
type OrderStatus = 'PENDING' | 'CONFIRMED' | 'DELIVERING' | 'DELIVERED' | 'CANCELLED';
type EggItemType = 'STANDARD_EGGS' | 'STARTER_EGGS' | 'CONSUMABLE_BROKEN_EGGS';

const EGG_TYPES: { key: EggItemType; label: string; pricingField: string }[] = [
  { key: 'STANDARD_EGGS',          label: 'Standard Eggs',             pricingField: 'pricePerEgg'        },
  { key: 'STARTER_EGGS',           label: 'Starter Eggs',              pricingField: 'pricePerEggStarter'  },
  { key: 'CONSUMABLE_BROKEN_EGGS', label: 'Consumable Broken Eggs',    pricingField: 'pricePerEggBroken'   },
];

const EGG_TYPE_LABELS: Record<EggItemType, string> = {
  STANDARD_EGGS:          'Standard Eggs',
  STARTER_EGGS:           'Starter Eggs',
  CONSUMABLE_BROKEN_EGGS: 'Consumable Broken Eggs',
};

const PAYMENT_METHODS = [
  { value: 'MPESA',  label: 'M-Pesa'        },
  { value: 'CASH',   label: 'Cash'           },
  { value: 'BANK',   label: 'Bank Transfer'  },
  { value: 'CREDIT', label: 'Credit'         },
];

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; icon: any }> = {
  PENDING:    { label: 'Pending',    color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',     icon: Clock       },
  CONFIRMED:  { label: 'Confirmed',  color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',         icon: CheckCircle },
  DELIVERING: { label: 'Delivering', color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400', icon: Truck       },
  DELIVERED:  { label: 'Delivered',  color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',     icon: CheckCircle },
  CANCELLED:  { label: 'Cancelled',  color: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',            icon: XCircle     },
};

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green disabled:opacity-60 disabled:cursor-not-allowed';

interface DailyPrice { pricePerEgg: number; pricePerEggStarter: number | null; pricePerEggBroken: number | null; expectedRevenue: number | null; }
interface OrderItem  { eggType: EggItemType; quantityEggs: number; }

function fmtKES(n?: number | string | null) {
  return `KES ${Number(n ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function getPricePerEgg(eggType: EggItemType, p: DailyPrice | null): number | null {
  if (!p) return null;
  if (eggType === 'STANDARD_EGGS')          return Number(p.pricePerEgg);
  if (eggType === 'STARTER_EGGS')           return p.pricePerEggStarter != null ? Number(p.pricePerEggStarter) : null;
  if (eggType === 'CONSUMABLE_BROKEN_EGGS') return p.pricePerEggBroken  != null ? Number(p.pricePerEggBroken)  : null;
  return null;
}
function calcSubtotal(eggType: EggItemType, eggs: number, p: DailyPrice | null): number {
  const peg = getPricePerEgg(eggType, p);
  return peg == null ? 0 : eggs * peg;
}

// ── Revenue Banner ─────────────────────────────────────────────────────────────
function RevenueBanner({ summary }: { summary: any }) {
  if (!summary) return null;
  const pct = summary.revenueProgressPct ?? 0;
  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-brand-green" /> Revenue Progress
        </p>
        <span className="text-xs text-gray-400">Today</span>
      </div>
      <div className="flex items-end gap-4 mb-2">
        <div><p className="text-xs text-gray-400 mb-0.5">Achieved</p><p className="text-lg font-bold text-brand-green">{fmtKES(summary.todayRevenue)}</p></div>
        <div className="text-gray-300 dark:text-gray-600 font-light text-xl mb-1">/</div>
        <div><p className="text-xs text-gray-400 mb-0.5">Expected</p><p className="text-lg font-bold text-gray-700 dark:text-gray-300">{summary.expectedRevenue != null ? fmtKES(summary.expectedRevenue) : '—'}</p></div>
        {summary.remainingRevenue != null && summary.remainingRevenue > 0 && (
          <div className="ml-auto text-right"><p className="text-xs text-gray-400 mb-0.5">Remaining</p><p className="text-sm font-bold text-amber-500">{fmtKES(summary.remainingRevenue)}</p></div>
        )}
      </div>
      {summary.expectedRevenue != null && (
        <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
          <div className="bg-brand-green h-2 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
      {!summary.pricingSet && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> No pricing set today — orders cannot be created until the accountant sets prices.
        </p>
      )}
    </div>
  );
}

// ── Order Card ─────────────────────────────────────────────────────────────────
function OrderCard({ order, onConfirm, onMarkDelivering, onMarkDelivered }: {
  order: any;
  onConfirm: (id: string) => void;
  onMarkDelivering: (id: string) => void;
  onMarkDelivered: (id: string, notes: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [showDeliverForm, setShowDeliverForm] = useState(false);
  const statusCfg = STATUS_CONFIG[order.status as OrderStatus] ?? STATUS_CONFIG.PENDING;
  const StatusIcon = statusCfg.icon;

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
      <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <div className="w-10 h-10 bg-brand-green/10 rounded-xl flex items-center justify-center flex-shrink-0">
          <ShoppingCart className="w-5 h-5 text-brand-green" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{order.orderNumber}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {order.customer?.name ?? '—'} · {dayjs(order.orderDate).format('D MMM YYYY')} · {order.paymentMethod}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <p className="text-sm font-bold text-brand-green">{fmtKES(order.subtotal)}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusCfg.color}`}>
            <StatusIcon className="w-3 h-3 inline mr-1" />{statusCfg.label}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-dark-border px-4 pb-4 space-y-3 pt-3">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-1">
            {(order.items ?? []).map((item: any) => (
              <div key={item.id} className="flex justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-400">
                  <Package className="w-3 h-3 inline mr-1" />
                  {EGG_TYPE_LABELS[item.itemType as EggItemType] ?? item.itemType} · {(item.quantityTrays ?? 0) * 30} eggs ({item.quantityTrays ?? 0} trays)
                </span>
                <span className="font-semibold text-gray-700 dark:text-gray-300">{fmtKES(item.subtotal)}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs font-bold border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
              <span>Total</span><span className="text-brand-green">{fmtKES(order.subtotal)}</span>
            </div>
          </div>
          {order.deliveryAddress && (
            <div className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
              <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{order.deliveryAddress}{order.deliveryDate && ` (${dayjs(order.deliveryDate).format('D MMM YYYY')})`}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {order.status === 'PENDING' && (
              <button onClick={() => onConfirm(order.id)} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
                <CheckCircle className="w-3 h-3" /> Confirm Order
              </button>
            )}
            {order.status === 'CONFIRMED' && order.deliveryAddress && (
              <button onClick={() => onMarkDelivering(order.id)} className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
                <Truck className="w-3 h-3" /> Mark as Out for Delivery
              </button>
            )}
            {order.status === 'DELIVERING' && (
              showDeliverForm ? (
                <div className="w-full space-y-2">
                  <input value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)} placeholder="Delivery notes (optional)" className={iCls} />
                  <div className="flex gap-2">
                    <button onClick={() => { onMarkDelivered(order.id, deliveryNotes); setShowDeliverForm(false); }} className="flex-1 bg-brand-green text-white py-2 rounded-xl text-xs font-semibold">Confirm Delivered</button>
                    <button onClick={() => setShowDeliverForm(false)} className="px-3 py-2 rounded-xl text-xs border border-gray-200 dark:border-dark-border text-gray-500">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowDeliverForm(true)} className="flex items-center gap-1 bg-brand-green text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
                  <CheckCircle className="w-3 h-3" /> Mark as Delivered
                </button>
              )
            )}
          </div>
          {order.notes && <p className="text-xs text-gray-400 italic border-t border-gray-100 dark:border-dark-border pt-2">{order.notes}</p>}
        </div>
      )}
    </div>
  );
}

// ── New Order Modal ────────────────────────────────────────────────────────────
function NewOrderModal({ onClose, pricing }: { onClose: () => void; pricing: DailyPrice | null }) {
  const qc = useQueryClient();
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => api.get('/sales/customers').then(r => r.data) });
  const [form, setForm] = useState({
    customerId: '', orderDate: dayjs().format('YYYY-MM-DD'),
    paymentMethod: 'CASH', requiresDelivery: false,
    deliveryAddress: '', deliveryDate: '', deliveryTime: '', notes: '',
    items: [{ eggType: 'STANDARD_EGGS' as EggItemType, quantityEggs: 30 }],
  });
  const [error, setError] = useState('');

  const addItem    = () => setForm(f => ({ ...f, items: [...f.items, { eggType: 'STANDARD_EGGS' as EggItemType, quantityEggs: 30 }] }));
  const removeItem = (i: number) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const updateItem = (i: number, field: keyof OrderItem, val: any) =>
    setForm(f => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [field]: val } : it) }));

  const orderTotal = form.items.reduce((s, it) => s + calcSubtotal(it.eggType, it.quantityEggs, pricing), 0);

  const createMutation = useMutation({
    mutationFn: (d: typeof form) => api.post('/sales/orders', {
      customerId: d.customerId, orderDate: d.orderDate, paymentMethod: d.paymentMethod,
      requiresDelivery: d.requiresDelivery,
      deliveryAddress:  d.requiresDelivery ? d.deliveryAddress : undefined,
      deliveryDate:     d.requiresDelivery && d.deliveryDate ? d.deliveryDate : undefined,
      deliveryTime:     d.requiresDelivery && d.deliveryTime ? d.deliveryTime : undefined,
      notes: d.notes || undefined,
      // Items use eggType — backend maps to itemType; no grade field sent
      items: d.items.map(it => ({ eggType: it.eggType, quantityEggs: Number(it.quantityEggs) })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-summary'] });
      qc.invalidateQueries({ queryKey: ['sales-stock'] });
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Failed to create order.'),
  });

  function validate(): string | null {
    if (!form.customerId) return 'Please select a customer';
    if (!form.items.length) return 'Add at least one item';
    for (const it of form.items) {
      if (it.quantityEggs <= 0) return 'All quantities must be greater than zero';
      if (getPricePerEgg(it.eggType, pricing) == null) return `No price set for ${EGG_TYPE_LABELS[it.eggType]}. Ask the accountant.`;
    }
    if (form.requiresDelivery && !form.deliveryAddress.trim()) return 'Enter delivery address';
    return null;
  }

  if (!pricing) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-6 max-w-md w-full shadow-2xl">
          <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <h2 className="font-bold text-gray-800 dark:text-gray-100 text-center mb-2">No Pricing Set Today</h2>
          <p className="text-sm text-gray-500 text-center mb-4">The accountant must set today's egg prices before orders can be created.</p>
          <button onClick={onClose} className="w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 py-2.5 rounded-xl text-sm font-semibold">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-dark-card rounded-2xl w-full max-w-2xl shadow-2xl my-4">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border">
          <h2 className="font-bold text-gray-800 dark:text-gray-100">New Sales Order</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-5 pt-4">
          <div className="bg-brand-green/5 border border-brand-green/20 rounded-xl p-3 text-xs space-y-1">
            <p className="font-semibold text-brand-green">Today's Pricing (auto-applied · set by accountant)</p>
            <p>Standard: <strong>KES {Number(pricing.pricePerEgg).toFixed(2)}/egg</strong> = KES {(Number(pricing.pricePerEgg) * 30).toFixed(2)}/tray</p>
            {pricing.pricePerEggStarter != null && <p>Starter: <strong>KES {Number(pricing.pricePerEggStarter).toFixed(2)}/egg</strong> = KES {(Number(pricing.pricePerEggStarter) * 30).toFixed(2)}/tray</p>}
            {pricing.pricePerEggBroken  != null && <p>Consumable Broken: <strong>KES {Number(pricing.pricePerEggBroken).toFixed(2)}/egg</strong> = KES {(Number(pricing.pricePerEggBroken) * 30).toFixed(2)}/tray</p>}
          </div>
        </div>
        <form onSubmit={e => { e.preventDefault(); const err = validate(); if (err) { setError(err); return; } setError(''); createMutation.mutate(form); }} className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Customer *</label>
              <select value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} className={iCls} required>
                <option value="">— Select customer —</option>
                {(customers as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Order Date *</label>
              <input type="date" value={form.orderDate} onChange={e => setForm(f => ({ ...f, orderDate: e.target.value }))} className={iCls} required />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-2 block">Payment Method *</label>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map(pm => (
                <button key={pm.value} type="button" onClick={() => setForm(f => ({ ...f, paymentMethod: pm.value }))}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${form.paymentMethod === pm.value ? 'bg-brand-green text-white border-brand-green' : 'bg-white dark:bg-dark-bg text-gray-600 dark:text-gray-400 border-gray-200 dark:border-dark-border'}`}>
                  {pm.label}
                </button>
              ))}
            </div>
          </div>
          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Order Items</p>
              <button type="button" onClick={addItem} className="flex items-center gap-1 text-brand-green text-xs font-semibold"><Plus className="w-3 h-3" /> Add Item</button>
            </div>
            <div className="space-y-2">
              {form.items.map((item, idx) => {
                const peg = getPricePerEgg(item.eggType, pricing);
                const sub = calcSubtotal(item.eggType, item.quantityEggs, pricing);
                return (
                  <div key={idx} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-gray-500 mb-1 block">Egg Category</label>
                        <select value={item.eggType} onChange={e => updateItem(idx, 'eggType', e.target.value as EggItemType)} className={iCls}>
                          {EGG_TYPES.map(g => (
                            <option key={g.key} value={g.key} disabled={getPricePerEgg(g.key, pricing) == null}>
                              {g.label}{getPricePerEgg(g.key, pricing) == null ? ' (no price set)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-32">
                        <label className="text-xs text-gray-500 mb-1 block">Quantity (eggs)</label>
                        <input type="number" min="1" value={item.quantityEggs} onChange={e => updateItem(idx, 'quantityEggs', Math.max(1, parseInt(e.target.value) || 1))} className={iCls} />
                      </div>
                      {form.items.length > 1 && <button type="button" onClick={() => removeItem(idx)} className="mt-5 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{item.quantityEggs} eggs ({Math.ceil(item.quantityEggs / 30)} trays){peg != null ? ` · KES ${peg.toFixed(2)}/egg` : ''}</span>
                      <span className="font-bold text-gray-700 dark:text-gray-300">{fmtKES(sub)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between items-center mt-2 px-1 text-sm font-bold text-gray-700 dark:text-gray-200">
              <span>Order Total</span><span className="text-brand-green">{fmtKES(orderTotal)}</span>
            </div>
          </div>
          {/* Delivery */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.requiresDelivery} onChange={e => setForm(f => ({ ...f, requiresDelivery: e.target.checked }))} className="w-4 h-4 rounded accent-brand-green" />
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Delivery Required</span>
            </label>
            {form.requiresDelivery && (
              <div className="mt-3 space-y-3 pl-6">
                <div><label className="text-xs text-gray-500 mb-1 block">Delivery Address *</label>
                  <input type="text" value={form.deliveryAddress} onChange={e => setForm(f => ({ ...f, deliveryAddress: e.target.value }))} placeholder="e.g. Emali Town, Shop 3" className={iCls} required={form.requiresDelivery} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-500 mb-1 block">Delivery Date</label><input type="date" value={form.deliveryDate} onChange={e => setForm(f => ({ ...f, deliveryDate: e.target.value }))} className={iCls} /></div>
                  <div><label className="text-xs text-gray-500 mb-1 block">Expected Time</label><input type="time" value={form.deliveryTime} onChange={e => setForm(f => ({ ...f, deliveryTime: e.target.value }))} className={iCls} /></div>
                </div>
              </div>
            )}
          </div>
          <div><label className="text-xs text-gray-500 mb-1 block">Notes (optional)</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={iCls} placeholder="Any additional instructions..." /></div>
          {error && <p className="text-xs text-red-600 flex items-center gap-1 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-xl"><AlertCircle className="w-3 h-3 flex-shrink-0" /> {error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={createMutation.isPending} className="flex-1 bg-brand-green text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
              {createMutation.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}
              {createMutation.isPending ? 'Creating…' : 'Create Order'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm border border-gray-200 dark:border-dark-border text-gray-500">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function SalesOrders() {
  const qc = useQueryClient();
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [days, setDays] = useState(30);

  const { data: todayPricing } = useQuery<DailyPrice | null>({
    queryKey: ['daily-price-today'],
    queryFn: () => api.get('/pricing/daily/today').then(r => r.data).catch(() => null),
    staleTime: 5 * 60_000, refetchInterval: 5 * 60_000,
  });
  const { data: summary } = useQuery({
    queryKey: ['sales-summary'],
    queryFn: () => api.get('/sales/summary').then(r => r.data),
    staleTime: 60_000,
  });
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['sales-orders', days, statusFilter],
    queryFn: () => api.get(`/sales/orders?days=${days}${statusFilter ? `&status=${statusFilter}` : ''}`).then(r => r.data),
    staleTime: 60_000,
  });

  const confirmMutation    = useMutation({ mutationFn: (id: string) => api.patch(`/sales/orders/${id}/confirm`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-orders'] }); qc.invalidateQueries({ queryKey: ['sales-summary'] }); } });
  const deliveringMutation = useMutation({ mutationFn: (id: string) => api.patch(`/sales/orders/${id}/delivering`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders'] }) });
  const deliveredMutation  = useMutation({ mutationFn: ({ id, notes }: { id: string; notes: string }) => api.patch(`/sales/orders/${id}/deliver`, { notes }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-orders'] }); qc.invalidateQueries({ queryKey: ['sales-summary'] }); } });

  const filters: { label: string; value: OrderStatus | '' }[] = [
    { label: 'All', value: '' }, { label: 'Pending', value: 'PENDING' }, { label: 'Confirmed', value: 'CONFIRMED' },
    { label: 'Delivering', value: 'DELIVERING' }, { label: 'Delivered', value: 'DELIVERED' }, { label: 'Cancelled', value: 'CANCELLED' },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-brand-green" /> Sales Orders</h1>
          <p className="text-xs text-gray-400 mt-0.5">Prices are set by the accountant and auto-applied. No manual price entry.</p>
        </div>
        <button onClick={() => setShowOrderForm(true)} disabled={!todayPricing}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          title={!todayPricing ? "Accountant must set today's pricing first" : 'Create new order'}>
          <Plus className="w-4 h-4" /> New Order
        </button>
      </div>
      <RevenueBanner summary={summary} />
      <div className="flex flex-wrap gap-2">
        {filters.map(({ label, value }) => (
          <button key={value} onClick={() => setStatusFilter(value)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${statusFilter === value ? 'bg-brand-green text-white' : 'bg-white dark:bg-dark-card text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-dark-border'}`}>
            {label}
          </button>
        ))}
        <div className="ml-auto">
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="text-xs border border-gray-200 dark:border-dark-border rounded-xl px-2 py-1.5 bg-white dark:bg-dark-card text-gray-600 dark:text-gray-400">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="bg-gray-100 dark:bg-dark-card rounded-2xl h-16 animate-pulse" />)}</div>
      ) : (orders as any[]).length === 0 ? (
        <div className="text-center py-14 text-gray-400 bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border">
          <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No orders found</p>
          <p className="text-sm mt-1">{statusFilter ? `No ${statusFilter.toLowerCase()} orders` : 'Create your first order'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(orders as any[]).map((order: any) => (
            <OrderCard key={order.id} order={order}
              onConfirm={id => confirmMutation.mutate(id)}
              onMarkDelivering={id => deliveringMutation.mutate(id)}
              onMarkDelivered={(id, notes) => deliveredMutation.mutate({ id, notes })} />
          ))}
        </div>
      )}
      {showOrderForm && <NewOrderModal onClose={() => setShowOrderForm(false)} pricing={todayPricing ?? null} />}
    </div>
  );
}
