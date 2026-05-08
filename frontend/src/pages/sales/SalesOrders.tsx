import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../../lib/api';
import dayjs from 'dayjs';
import {
  ShoppingCart, Plus, X, ChevronDown, ChevronUp, User, Phone,
  Info, CheckCircle, Clock, XCircle, Truck, DollarSign,
  Package, Hash, Calendar, TrendingUp, AlertCircle
} from 'lucide-react';

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

// ── Types & config ────────────────────────────────────────────────────────────
type OrderStatus = 'PENDING' | 'CONFIRMED' | 'DELIVERED' | 'RETURNED' | 'CANCELLED';

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; icon: any; tip: string }> = {
  PENDING:   { label: 'Pending',   color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',   icon: Clock,       tip: 'Order created but not yet confirmed by the supervisor' },
  CONFIRMED: { label: 'Confirmed', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',       icon: CheckCircle, tip: 'Order confirmed and ready for delivery' },
  DELIVERED: { label: 'Delivered', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',   icon: Truck,       tip: 'Order delivered to the customer' },
  RETURNED:  { label: 'Returned',  color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',           icon: XCircle,     tip: 'Order was returned by the customer' },
  CANCELLED: { label: 'Cancelled', color: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',          icon: XCircle,     tip: 'Order was cancelled' },
};

const TIER_CONFIG = {
  TIER_1: { label: 'Tier 1',  tip: 'Retail / small buyer: 1–10 trays. Standard retail price applies.',   color: 'text-blue-600' },
  TIER_2: { label: 'Tier 2',  tip: 'Wholesale / bulk buyer: 11+ trays. Discounted wholesale price applies.', color: 'text-brand-green' },
};

// Egg types for sales orders
const EGG_TYPES = [
  { key: 'NORMAL',          label: 'Normal Eggs',              priceField: 'pricePerEggProduction' },
  { key: 'STARTER',         label: 'Starter Eggs',             priceField: 'pricePerEggStarter' },
  { key: 'BROKEN_SELLABLE', label: 'Broken but Sellable Eggs', priceField: 'pricePerEggBroken' },
];

const PAYMENT_METHODS = [
  { value: 'MPESA',         label: 'M-Pesa',        tip: 'Safaricom M-Pesa mobile money transfer' },
  { value: 'CASH',          label: 'Cash',           tip: 'Physical cash payment on delivery' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer',  tip: 'Direct bank-to-bank transfer' },
];

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useCustomers() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get('/sales/customers').then(r => r.data),
    staleTime: 5 * 60_000,
  });
}

function useSalesOrders(days = 30) {
  return useQuery({
    queryKey: ['sales-orders', days],
    queryFn: () => api.get(`/sales/orders?days=${days}`).then(r => r.data),
    staleTime: 60_000,
  });
}

function useSalesSummary() {
  return useQuery({
    queryKey: ['sales-summary'],
    queryFn: () => api.get('/sales/summary').then(r => r.data),
    staleTime: 60_000,
  });
}

// ── New Order Form ────────────────────────────────────────────────────────────
const orderSchema = z.object({
  customerId:      z.string().min(1, 'Select a customer'),
  orderDate:       z.string().min(1, 'Date required'),
  paymentMethod:   z.string().min(1, 'Select payment method'),
  deliveryAddress: z.string().optional(),
  isFarmDelivery:  z.boolean().optional(),
  notes:           z.string().optional(),
  items: z.array(z.object({
    eggType:       z.string().min(1),
    quantityEggs:  z.coerce.number().int().min(1, 'At least 1 egg'),
    pricePerEgg:   z.coerce.number().positive('Price required'),
  })).min(1, 'Add at least one item'),
});
type OrderForm = z.infer<typeof orderSchema>;

function NewOrderModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: customers = [] } = useCustomers();
  const { data: todayPrice } = useQuery({
    queryKey: ['daily-price', 'today'],
    queryFn: () => api.get('/pricing/daily/today').then(r => r.data).catch(() => null),
    staleTime: 5 * 60_000,
  });
  const autoPrice = todayPrice?.pricePerEggProduction ? Number(todayPrice.pricePerEggProduction) : 0;
  const autoStarterPrice = todayPrice?.pricePerEggStarter ? Number(todayPrice.pricePerEggStarter) : 0;
  const autoBrokenPrice = todayPrice?.pricePerEggBroken ? Number(todayPrice.pricePerEggBroken) : 0;

  const getPriceForType = (eggType: string) => {
    if (eggType === 'STARTER') return autoStarterPrice;
    if (eggType === 'BROKEN_SELLABLE') return autoBrokenPrice;
    return autoPrice;
  };

  const [items, setItems] = useState([{ eggType: 'NORMAL', quantityEggs: 30, pricePerEgg: autoPrice }]);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      orderDate: dayjs().format('YYYY-MM-DD'),
      items: [{ eggType: 'NORMAL', quantityEggs: 30, pricePerEgg: autoPrice }],
    },
  });

  const submit = useMutation({
    mutationFn: (data: OrderForm) => api.post('/sales/orders', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-summary'] });
      onClose();
    },
  });

  const watchedItems = watch('items') ?? items;
  const subtotal = watchedItems.reduce((sum, item) =>
    sum + (Number(item.quantityEggs ?? 0) * Number(item.pricePerEgg ?? 0)), 0
  );
  const totalEggs = watchedItems.reduce((sum, item) => sum + Number(item.quantityEggs ?? 0), 0);
  const totalTrays = Math.floor(totalEggs / 30);
  const remainderEggs = totalEggs % 30;
  const tier = totalEggs >= 330 ? 'TIER_2' : 'TIER_1'; // 11+ trays = 330+ eggs

  const addItem = () => {
    const newItems = [...watchedItems, { eggType: 'NORMAL', quantityEggs: 30, pricePerEgg: autoPrice }];
    setItems(newItems);
    setValue('items', newItems);
  };

  const removeItem = (i: number) => {
    const newItems = watchedItems.filter((_, idx) => idx !== i);
    setItems(newItems);
    setValue('items', newItems);
  };

  const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-teal';
  const labelCls = 'block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide';

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-xl rounded-t-3xl md:rounded-2xl
        shadow-2xl overflow-y-auto max-h-[95vh] md:max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-teal rounded-xl flex items-center justify-center">
              <ShoppingCart className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">New Sales Order</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Record egg sale</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-4">

          {/* Customer + Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Customer *</label>
              <select {...register('customerId')} className={inputCls}>
                <option value="">Select customer...</option>
                {customers.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.customerId && <p className="text-red-500 text-xs mt-1">{errors.customerId.message}</p>}
            </div>
            <div>
              <label className={labelCls}>Order Date *</label>
              <input {...register('orderDate')} type="date" className={inputCls} />
            </div>
          </div>

          {/* Payment method */}
          <div>
            <label className={labelCls}>Payment Method *</label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map(pm => (
                <label key={pm.value} className="cursor-pointer w-full">
                  <input type="radio" {...register('paymentMethod')} value={pm.value} className="sr-only" />
                  <div className={`text-center py-2.5 px-2 rounded-xl border-2 text-xs font-semibold transition-colors
                    ${watch('paymentMethod') === pm.value
                      ? 'border-brand-teal bg-brand-teal/10 dark:bg-brand-teal/20 text-brand-teal'
                      : 'border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 hover:border-gray-300'
                    }`}>
                    {pm.label}
                  </div>
                </label>
              ))}
            </div>
            {errors.paymentMethod && <p className="text-red-500 text-xs mt-1">{errors.paymentMethod.message}</p>}
          </div>

          {/* Order items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls}>Order Items *</label>
              <button type="button" onClick={addItem}
                className="text-xs text-brand-teal font-semibold flex items-center gap-1 hover:underline">
                <Plus className="w-3 h-3" /> Add item
              </button>
            </div>

            {!autoPrice && (
              <div className="mb-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Accountant has not set today's price yet — enter price manually.
                </p>
              </div>
            )}

            <div className="space-y-2">
              {watchedItems.map((item, i) => {
                const eggs = Number(watch(`items.${i}.quantityEggs`) ?? 0);
                const ppu  = Number(watch(`items.${i}.pricePerEgg`) ?? 0);
                const lineTotal = eggs * ppu;
                const lineTraysFull = Math.floor(eggs / 30);
                const lineRemainder = eggs % 30;
                return (
                  <div key={i} className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 space-y-2">
                    <div className="flex gap-2 items-start">
                      <div className="flex-1 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          {/* Egg Type dropdown */}
                          <div>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">Egg Type</p>
                            <select
                              {...register(`items.${i}.eggType`)}
                              onChange={e => {
                                const price = getPriceForType(e.target.value);
                                setValue(`items.${i}.eggType`, e.target.value);
                                setValue(`items.${i}.pricePerEgg`, price);
                              }}
                              className="w-full border border-gray-200 dark:border-dark-border rounded-lg px-2 py-2 text-xs bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-teal"
                            >
                              {EGG_TYPES.map(t => (
                                <option key={t.key} value={t.key}>{t.label}</option>
                              ))}
                            </select>
                          </div>
                          {/* Quantity in eggs */}
                          <div>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">Quantity (eggs)</p>
                            <input
                              {...register(`items.${i}.quantityEggs`)}
                              type="number" min="1" inputMode="numeric"
                              className="w-full border border-gray-200 dark:border-dark-border rounded-lg px-2 py-2 text-xs bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-teal text-center font-bold"
                            />
                          </div>
                        </div>
                        {/* KES per egg — auto-filled from accountant pricing */}
                        <div>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">KES / egg (auto-filled)</p>
                          <input
                            {...register(`items.${i}.pricePerEgg`)}
                            type="number" min="0" step="0.01" inputMode="decimal"
                            readOnly={!!getPriceForType(watch(`items.${i}.eggType`) ?? 'NORMAL')}
                            className="w-full border border-gray-200 dark:border-dark-border rounded-lg px-2 py-2 text-xs bg-gray-50 dark:bg-dark-border text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-teal text-center font-bold cursor-not-allowed"
                          />
                          {!getPriceForType(watch(`items.${i}.eggType`) ?? 'NORMAL') && (
                            <p className="text-[10px] text-amber-500 mt-0.5">Price not set by accountant — enter manually</p>
                          )}
                        </div>
                      </div>
                      {watchedItems.length > 1 && (
                        <button type="button" onClick={() => removeItem(i)}
                          className="mt-5 p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {/* Per-line tray conversion + total */}
                    {eggs > 0 && ppu > 0 && (
                      <div className="flex items-center justify-between text-xs text-gray-400 px-0.5">
                        <span>
                          {lineTraysFull > 0 ? `${lineTraysFull} tray${lineTraysFull > 1 ? 's' : ''}` : ''}
                          {lineRemainder > 0 ? `${lineTraysFull > 0 ? ' + ' : ''}${lineRemainder} loose` : ''}
                        </span>
                        <span className="font-semibold text-brand-teal">KES {lineTotal.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {errors.items && <p className="text-red-500 text-xs mt-1">{(errors.items as any)?.message ?? 'Check item fields'}</p>}
          </div>

          {subtotal > 0 && (
            <div className="bg-brand-teal/10 dark:bg-brand-teal/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold ${TIER_CONFIG[tier].color}`}>
                  {TIER_CONFIG[tier].label}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {totalEggs} eggs
                  {totalTrays > 0 && ` · ${totalTrays} tray${totalTrays > 1 ? 's' : ''}${remainderEggs > 0 ? ` + ${remainderEggs}` : ''}`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-brand-teal">Order Total</span>
                <span className="text-xl font-bold text-brand-teal">
                  KES {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          {/* Farm Delivery tracking */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" {...register('isFarmDelivery')} className="w-4 h-4 accent-brand-teal rounded" />
              <div>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Farm will deliver this order</p>
                <p className="text-xs text-gray-400">Enables delivery tracking and driver assignment</p>
              </div>
            </label>
          </div>

          {/* Delivery address + notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Delivery Address (optional)</label>
              <input {...register('deliveryAddress')} className={inputCls} placeholder="e.g. Westlands, Nairobi" />
            </div>
            <div>
              <label className={labelCls}>Notes (optional)</label>
              <input {...register('notes')} className={inputCls} placeholder="Any order remarks..." />
            </div>
          </div>

          {submit.error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3 text-red-700 dark:text-red-400 text-sm">
              {(submit.error as any)?.response?.data?.message ?? 'Failed to create order. Please try again.'}
            </div>
          )}

          <button type="submit" disabled={submit.isPending}
            className="w-full bg-brand-teal text-white rounded-xl py-4 font-bold text-sm
              hover:opacity-90 transition-opacity disabled:opacity-60 min-h-[52px]
              flex items-center justify-center gap-2 active:scale-[0.98]">
            {submit.isPending ? 'Creating...' : <><ShoppingCart className="w-4 h-4" /> Create Order</>}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Order card ────────────────────────────────────────────────────────────────
function OrderCard({ order }: { order: any }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_CONFIG[order.status as OrderStatus];
  const StatusIcon = status.icon;
  const tier = TIER_CONFIG[order.tier as keyof typeof TIER_CONFIG];

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors"
      >
        {/* Status icon */}
        <Tooltip tip={status.tip}>
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 cursor-default
            ${order.status === 'DELIVERED' ? 'bg-green-100 dark:bg-green-900/30' :
              order.status === 'CONFIRMED' ? 'bg-blue-100 dark:bg-blue-900/30' :
              order.status === 'PENDING'   ? 'bg-amber-100 dark:bg-amber-900/30' :
              'bg-gray-100 dark:bg-gray-800'}`}>
            <StatusIcon className={`w-4 h-4 ${
              order.status === 'DELIVERED' ? 'text-green-600 dark:text-green-400' :
              order.status === 'CONFIRMED' ? 'text-blue-600 dark:text-blue-400' :
              order.status === 'PENDING'   ? 'text-amber-600 dark:text-amber-400' :
              'text-gray-400'}`} />
          </div>
        </Tooltip>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">
              {order.customer?.name}
            </p>
            <Tooltip tip={status.tip}>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold cursor-default ${status.color}`}>
                {status.label}
              </span>
            </Tooltip>
            <Tooltip tip={tier?.tip}>
              <span className={`text-xs font-semibold cursor-default ${tier?.color}`}>
                {tier?.label}
              </span>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400 dark:text-gray-500">
            <span className="font-mono">{order.orderNumber}</span>
            <span>·</span>
            <span>{dayjs(order.orderDate).format('D MMM YYYY')}</span>
          </div>
        </div>

        {/* Subtotal */}
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
            KES {Number(order.subtotal).toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
          {order.items?.reduce((s: number, i: any) => s + (i.quantityEggs != null ? i.quantityEggs : (i.quantityTrays ?? 0) * 30), 0)} eggs
          </p>
        </div>

        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        }
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-50 dark:border-dark-border space-y-3">
          {/* Items table */}
          <div className="mt-3 overflow-hidden rounded-xl border border-gray-100 dark:border-dark-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-dark-bg">
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 dark:text-gray-400">Egg Type</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500 dark:text-gray-400">Eggs</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500 dark:text-gray-400">KES/Egg</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-500 dark:text-gray-400">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {order.items?.map((item: any, i: number) => (
                  <tr key={i} className="border-t border-gray-50 dark:border-dark-border">
                    <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
                      {EGG_TYPES.find(t => t.key === item.eggType)?.label ?? item.eggType ?? item.grade ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-700 dark:text-gray-300">{item.quantityEggs ?? item.quantityTrays * 30}</td>
                    <td className="px-3 py-2 text-center text-gray-700 dark:text-gray-300">{Number(item.pricePerEgg ?? item.unitPrice).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-800 dark:text-gray-100">{Number(item.subtotal).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-400 dark:text-gray-500">
            {order.customer?.phone && (
              <Tooltip tip="Customer phone number">
                <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{order.customer.phone}</span>
              </Tooltip>
            )}
            {order.deliveryAddress && (
              <Tooltip tip="Delivery address for this order">
                <span className="flex items-center gap-1"><Truck className="w-3 h-3" />{order.deliveryAddress}</span>
              </Tooltip>
            )}
            <Tooltip tip="Internal order reference number">
              <span className="flex items-center gap-1 font-mono"><Hash className="w-3 h-3" />{order.orderNumber}</span>
            </Tooltip>
          </div>
          {order.notes && (
            <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-dark-bg rounded-lg p-2.5">
              {order.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Sales page ───────────────────────────────────────────────────────────
export function SalesOrders() {
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [days, setDays] = useState(0); // 0 = today
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>(undefined);

  const { data: orders = [], isLoading } = useSalesOrders(days);
  const { data: summary } = useSalesSummary();

  const filtered = statusFilter ? orders.filter((o: any) => o.status === statusFilter) : orders;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Sales</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Egg sales orders · Customer records
          </p>
        </div>
        <button
          onClick={() => setShowOrderForm(true)}
          className="flex items-center gap-2 bg-brand-teal text-white px-4 py-2.5
            rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity
            shadow-sm active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          New Order
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tooltip tip="Total egg sales revenue in the selected period">
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 cursor-default">
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign className="w-3.5 h-3.5 text-brand-teal" />
              <p className="text-xs text-gray-400 dark:text-gray-500">Revenue ({days}d)</p>
            </div>
            <p className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {summary ? `KES ${(summary.totalRevenue / 1000).toFixed(1)}K` : '—'}
            </p>
          </div>
        </Tooltip>
        <Tooltip tip="Total eggs sold in the selected period">
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 cursor-default">
            <div className="flex items-center gap-1.5 mb-1">
              <Package className="w-3.5 h-3.5 text-brand-green" />
              <p className="text-xs text-gray-400 dark:text-gray-500">Eggs Sold</p>
            </div>
            <p className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {summary?.totalEggs ?? summary?.totalTrays != null ? (summary.totalEggs ?? summary.totalTrays * 30) : '—'}
            </p>
          </div>
        </Tooltip>
        <Tooltip tip="Number of sales orders in the selected period">
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 cursor-default">
            <div className="flex items-center gap-1.5 mb-1">
              <ShoppingCart className="w-3.5 h-3.5 text-blue-500" />
              <p className="text-xs text-gray-400 dark:text-gray-500">Orders</p>
            </div>
            <p className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {orders.length}
            </p>
          </div>
        </Tooltip>
        <Tooltip tip="Average revenue per egg across all sales this period">
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 cursor-default">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-purple-500" />
              <p className="text-xs text-gray-400 dark:text-gray-500">Avg/Egg</p>
            </div>
            <p className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {summary?.avgPerEgg
                ? `KES ${Number(summary.avgPerEgg).toFixed(2)}`
                : summary?.avgPerTray
                  ? `KES ${(Number(summary.avgPerTray) / 30).toFixed(2)}`
                  : '—'}
            </p>
          </div>
        </Tooltip>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter(undefined)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors
            ${!statusFilter ? 'bg-brand-teal text-white' : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border'}`}
        >
          All ({orders.length})
        </button>
        {(Object.entries(STATUS_CONFIG) as [OrderStatus, any][]).map(([s, cfg]) => {
          const count = orders.filter((o: any) => o.status === s).length;
          if (count === 0) return null;
          return (
            <Tooltip key={s} tip={cfg.tip}>
              <button
                onClick={() => setStatusFilter(statusFilter === s ? undefined : s)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors
                  ${statusFilter === s ? 'bg-brand-teal text-white' : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border'}`}
              >
                {cfg.label} ({count})
              </button>
            </Tooltip>
          );
        })}
        <div className="flex gap-1 ml-auto">
          {[{ label: 'Today', d: 1 }, { label: '7d', d: 7 }, { label: '30d', d: 30 }, { label: '90d', d: 90 }].map(({ label, d }) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors
                ${days === d ? 'bg-brand-teal text-white' : 'bg-gray-100 dark:bg-dark-card text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="bg-gray-100 dark:bg-dark-card rounded-2xl h-20 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 text-gray-400 dark:text-gray-500 bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border">
          <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No orders found</p>
          <p className="text-sm mt-1">
            {statusFilter ? `No ${STATUS_CONFIG[statusFilter].label.toLowerCase()} orders` : 'Create your first sales order to get started'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order: any) => <OrderCard key={order.id} order={order} />)}
        </div>
      )}

      {showOrderForm && <NewOrderModal onClose={() => setShowOrderForm(false)} />}
    </div>
  );
}
