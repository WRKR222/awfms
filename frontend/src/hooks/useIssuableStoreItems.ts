// src/hooks/useIssuableStoreItems.ts
//
// Items that Store has actually issued (stock-out) this week, in a given
// category or categories, with residual = issued - dispensed already
// computed server-side.
//
// Used by:
//   • Lead Attendant feed / vaccine / supplement / treatment logging forms
//     — only issued items are selectable, so the attendant can't log
//     against something never physically handed to them.
//   • Store's issuance-plan screen — to see leftover stock before
//     re-issuing the same item next week (avoid over-issuing).

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api/client';

export interface IssuableStoreItem {
  id: string;
  name: string;
  sku: string;
  unit: string;
  category: string;
  issuedThisWeek: number;
  dispensedThisWeek: number;
  residual: number;
}

export const FEED_CATEGORIES = ['FEED', 'FEED_SUPPLEMENT'] as const;
export const MEDICATION_CATEGORIES = ['MEDICATION', 'SUPPLEMENT'] as const;

export function useIssuableStoreItems(categories: readonly string[]) {
  const key = [...categories].sort().join(',');
  return useQuery<IssuableStoreItem[]>({
    queryKey: ['store-issuable-items', key],
    queryFn: () =>
      api
        .get('/store/inventory/issuable-items', { params: { categories: key } })
        .then(r => r.data),
    enabled: categories.length > 0,
    staleTime: 15_000,
  });
}
