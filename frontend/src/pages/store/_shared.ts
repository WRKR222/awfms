// src/pages/store/inventory/_shared.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

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

export function fmtKES(n: number | string | undefined | null) {
  const v = Number(n ?? 0);
  return `KES ${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function useStoreItems(activeOnly = true) {
  return useQuery({
    queryKey: ['store-items', activeOnly ? 'active' : 'all'],
    queryFn: async () => {
      const res = await api.get('/store/inventory/items', {
        params: activeOnly ? { isActive: 'true' } : {},
      });
      return res.data as StoreItem[];
    },
    staleTime: 0,          // always refetch store-items on tab focus — critical for stock-in dropdown
    refetchOnWindowFocus: true,
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
      return res.data as Array<{ id: string; batchCode: string; houseId: string; stage: string }>;
    },
    staleTime: 5 * 60_000,
  });
}

// A batch's stage says which physical building currently holds it —
// BROODING/GROWER birds live in the brooder, PRODUCTION birds live in the
// production (laying) house. Used to filter the batch picker once Store
// has chosen a stock-out destination, and to label existing records.
export function isBrooderStage(stage: string) {
  return stage === 'BROODING' || stage === 'GROWER';
}
export function isProductionStage(stage: string) {
  return stage === 'PRODUCTION';
}


