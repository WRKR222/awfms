// src/pages/store/inventory/StoreInventoryPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';
import { Package, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Clock } from 'lucide-react';
import { ItemsTab } from './ItemsTab';
import { StockInTab } from './StockInTab';
import { StockOutTab } from './StockOutTab';

type TabKey = 'items' | 'stock-in' | 'stock-out';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'items',     label: 'Items',     icon: Package },
  { key: 'stock-in',  label: 'Stock In',  icon: ArrowDownToLine },
  { key: 'stock-out', label: 'Stock Out', icon: ArrowUpFromLine },
];


function ExpiryAlertBanner() {
  const { data: expiring = [] } = useQuery<any[]>({
    queryKey: ['store-expiring'],
    queryFn: () => api.get('/store/inventory/expiring').then(r => r.data).catch(() => []),
    staleTime: 5 * 60_000,
  });

  const critical = expiring.filter((e: any) => e.severity === 'critical');
  const warning = expiring.filter((e: any) => e.severity === 'warning');

  if (expiring.length === 0) return null;

  return (
    <div className="space-y-2">
      {critical.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <p className="font-bold text-red-700 dark:text-red-400 text-sm">
              Expiring Within 1 Month — {critical.length} item{critical.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {critical.map((e: any) => (
              <span key={e.id} className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs px-3 py-1 rounded-full font-medium">
                {e.item.name} — expires {dayjs(e.expiryDate).format('D MMM YYYY')} ({e.daysUntilExpiry}d left)
              </span>
            ))}
          </div>
        </div>
      )}
      {warning.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <p className="font-bold text-amber-700 dark:text-amber-400 text-sm">
              Expiring Within 2 Months — {warning.length} item{warning.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {warning.map((e: any) => (
              <span key={e.id} className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs px-3 py-1 rounded-full font-medium">
                {e.item.name} — expires {dayjs(e.expiryDate).format('D MMM YYYY')} ({e.daysUntilExpiry}d left)
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StoreInventoryPage() {
  const [tab, setTab] = useState<TabKey>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'stock-out') return 'stock-out';
    return 'items';
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100">Store Inventory</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Manage catalogue and stock movements.
        </p>
      </header>

      {/* Expiry Alerts */}
      <ExpiryAlertBanner />

      <div className="flex gap-1 overflow-x-auto bg-white dark:bg-dark-card rounded-2xl p-1 border border-gray-100 dark:border-dark-border">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs md:text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-brand-green text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      <div>
        {tab === 'items'         && <ItemsTab />}
        {tab === 'stock-in'      && <StockInTab />}
        {tab === 'stock-out'     && <StockOutTab />}
      </div>
    </div>
  );
}
