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

// Deprecated: kept only so older code that hasn't been migrated yet still
// compiles. Do NOT use this for new vaccine/supplement/treatment pickers —
// it lumps all three together, which is exactly what attendants must never
// see (a vaccine picker showing supplements, etc). Use the three category
// sets below instead.
export const MEDICATION_CATEGORIES = ['MEDICATION', 'SUPPLEMENT', 'VACCINE'] as const;

// Vaccines only — Store items tagged under the dedicated VACCINE category.
export const VACCINE_CATEGORIES = ['VACCINE'] as const;

// Supplements only (vitamins, electrolytes, feed additives given as a
// supplement rather than a medical treatment).
export const SUPPLEMENT_CATEGORIES = ['SUPPLEMENT'] as const;

// Treatments/medication only (antibiotics, dewormers, other medical
// treatments) — explicitly excludes VACCINE and SUPPLEMENT.
export const TREATMENT_CATEGORIES = ['MEDICATION'] as const;

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
    retry: (failureCount, error: any) => {
      // Don't retry auth/permission failures — retrying won't help and just
      // delays surfacing the real problem to the user.
      if (error?.response?.status === 401 || error?.response?.status === 403) return false;
      return failureCount < 3;
    },
  });
}
