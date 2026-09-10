// src/hooks/useIssuableStoreItems.ts
//
// Store items in a given category or categories, with issued/dispensed/
// residual (and overDrawnBy) computed server-side from the all-time stock
// ledger.
//
// Used by:
//   • Lead Attendant feed / vaccine / supplement / treatment logging forms
//     — pass `{ allItems: true }` so every active item in the category with
//     currentStock > 0 in the Store role is selectable, not just ones
//     Store has already issued to that batch/session this week: feed, and
//     bulk-issued supplements/treatments especially, are often physically
//     handed over before (or independent of) Store logging the stock-out
//     in the system. The attached residual/overDrawnBy figures still let
//     the amount recorded be tied back to what Store issues, so surplus or
//     over-issuance stays visible once it is logged — it just isn't a hard
//     gate on recording. Items Store has fully run out of (currentStock 0)
//     are excluded even in this mode.
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
  currentStock: number;
  issuedThisWeek: number;
  dispensedThisWeek: number;
  residual: number;
  overDrawnBy: number;
}

export const FEED_CATEGORIES = ['FEED', 'FEED_SUPPLEMENT'] as const;

// Deprecated: kept only so older code (e.g. Store's issuance-plan residual
// summary) that hasn't been migrated yet still compiles/works. Do NOT use
// this for new vaccine/supplement/treatment pickers — it lumps all four
// together, which is exactly what attendants must never see (a vaccine
// picker showing supplements, etc). Use the three category sets below
// instead. Includes legacy MEDICATION too, since not every pre-existing
// MEDICATION item has been re-tagged into VACCINE/TREATMENT yet.
export const MEDICATION_CATEGORIES = ['MEDICATION', 'SUPPLEMENT', 'VACCINE', 'TREATMENT'] as const;

// Vaccines only — Store items tagged under the dedicated VACCINE category.
export const VACCINE_CATEGORIES = ['VACCINE'] as const;

// Supplements only (vitamins, electrolytes, feed additives given as a
// supplement rather than a medical treatment).
export const SUPPLEMENT_CATEGORIES = ['SUPPLEMENT'] as const;

// Treatments only — Store items tagged under the dedicated TREATMENT
// category (antibiotics, dewormers, other medical treatments), split out
// of MEDICATION the same way VACCINE was. Existing MEDICATION items that
// are really treatments are NOT auto-migrated — Store/PM re-tags them into
// TREATMENT by hand, same as the VACCINE split.
export const TREATMENT_CATEGORIES = ['TREATMENT'] as const;

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
