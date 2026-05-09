// src/pages/store/inventory/_shared.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';

export type StoreItem = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  description?: string | null;
  reorderLevel: number;
  unitCostKes: number;
  currentStock: number;
  isActive: boolean;
  supplierId?: string | null;
};

export type PurchaseRequest = {
  id: string;
  requestRef: string;
  requestDate: string;
  status: 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'REJECTED' | 'LPO_RAISED';
  urgency: 'LOW' | 'NORMAL' | 'URGENT';
  notes?: string | null;
  reviewNotes?: string | null;
  createdBy?: { fullName: string; role: string };
  reviewedBy?: { fullName: string } | null;
  items: Array<{
    id: string;
    storeItemId: string;
    quantityRequested: number;
    estimatedUnitCost: number;
    reason?: string | null;
    storeItem?: { name: string; unit: string };
  }>;
  lpo?: { lpoNumber: string; status: string } | null;
};

export type LPO = {
  id: string;
  lpoNumber: string;
  lpoDate: string;
  expectedDelivery?: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RECEIVED' | 'CANCELLED';
  supplierName: string;
  subtotalKes: number;
  vatKes: number;
  totalKes: number;
  notes?: string | null;
  purchaseRequest?: { requestRef: string } | null;
  items: Array<{
    id: string;
    storeItemId: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    storeItem?: { name: string; unit: string };
  }>;
};

export function fmtKES(n: number | string | undefined | null) {
  const v = Number(n ?? 0);
  return `KES ${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function useStoreItems(activeOnly = true) {
  return useQuery({
    queryKey: ['store-items', activeOnly],
    queryFn: async () => {
      const res = await api.get('/store/inventory/items', {
        params: activeOnly ? { isActive: 'true' } : {},
      });
      return res.data as StoreItem[];
    },
    staleTime: 60_000,
  });
}

export function useHouses() {
  return useQuery({
    queryKey: ['houses'],
    queryFn: async () => {
      const res = await api.get('/flock/houses');
      return res.data as Array<{ id: string; name: string; code: string }>;
    },
    staleTime: 5 * 60_000,
  });
}

export function useBatches() {
  return useQuery({
    queryKey: ['batches-active'],
    queryFn: async () => {
      const res = await api.get('/flock/batches?isActive=true');
      return res.data as Array<{ id: string; batchCode: string; houseId: string }>;
    },
    staleTime: 5 * 60_000,
  });
}

export const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  SUBMITTED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  REVIEWED:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  APPROVED:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  REJECTED:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  LPO_RAISED:'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  RECEIVED:  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
};

export const URGENCY_BADGE: Record<string, string> = {
  LOW:    'bg-gray-100 text-gray-600',
  NORMAL: 'bg-blue-100 text-blue-700',
  URGENT: 'bg-orange-100 text-orange-700',
};
