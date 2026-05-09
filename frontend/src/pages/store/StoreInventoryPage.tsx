// src/pages/store/inventory/StoreInventoryPage.tsx
import { useState } from 'react';
import { Package, ArrowDownToLine, ArrowUpFromLine, ClipboardList, FileText } from 'lucide-react';
import { ItemsTab } from './ItemsTab';
import { StockInTab } from './StockInTab';
import { StockOutTab } from './StockOutTab';
import { PurchaseRequestsTab } from './PurchaseRequestsTab';
import { LposTab } from './LposTab';

type TabKey = 'items' | 'stock-in' | 'stock-out' | 'requests' | 'lpos';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'items',     label: 'Items',             icon: Package },
  { key: 'stock-in',  label: 'Stock In',          icon: ArrowDownToLine },
  { key: 'stock-out', label: 'Stock Out',         icon: ArrowUpFromLine },
  { key: 'requests',  label: 'Purchase Requests', icon: ClipboardList },
  { key: 'lpos',      label: 'LPOs',              icon: FileText },
];

export default function StoreInventoryPage() {
  const [tab, setTab] = useState<TabKey>('items');

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100">Store Inventory</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Manage catalogue, stock movements, purchase requests and LPOs.
        </p>
      </header>

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
        {tab === 'items'     && <ItemsTab />}
        {tab === 'stock-in'  && <StockInTab />}
        {tab === 'stock-out' && <StockOutTab />}
        {tab === 'requests'  && <PurchaseRequestsTab />}
        {tab === 'lpos'      && <LposTab />}
      </div>
    </div>
  );
}
