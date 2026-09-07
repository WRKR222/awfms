// src/hooks/useIssuableStoreItems.ts
//
// Store items in a given category or categories, with issued/dispensed/
// residual (and overDrawnBy) computed server-side from the all-time stock
// ledger.
//
// Used by:
//   • Lead Attendant feed / vaccine / supplement / treatment logging forms
//     — pass `{ allItems: true }` so every active item in the category is
//     selectable, not just ones Store has already issued: feed, and
//     bulk-issued supplements/treatments especially, are often physically
//     handed over before (or independent of) Store logging the stock-out
//     in the system. The attached residual/overDrawnBy figures still let
//     the amount recorded be tied back to what Store issues, so surplus or
//     over-issuance stays visible once it is logged — it just isn't a hard
//     gate on recording.
//   • Store's issuance-plan screen — default (allItems omitted/false) shows
//     only items with unconsumed issued stock, to see leftover before
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
  overDrawnBy: number;
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

export function useIssuableStoreItems(
  categories: readonly string[],
  opts: { allItems?: boolean } = {},
) {
  const key = [...categories].sort().join(',');
  const allItems = opts.allItems ?? false;
  return useQuery<IssuableStoreItem[]>({
    queryKey: ['store-issuable-items', key, allItems],
    queryFn: () =>
      api
        .get('/store/inventory/issuable-items', { params: { categories: key, all: allItems ? 'true' : undefined } })
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
