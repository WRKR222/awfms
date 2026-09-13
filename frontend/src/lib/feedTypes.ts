// src/lib/feedTypes.ts
//
// Fixed layer feed-stage names for Egg Collection and Brooder feed logging.
// No longer tied to a specific Store-issued item — the attendant just picks
// the feed stage and records kg dispensed. Store's own daily issuance is
// compared against this separately for monitoring (see the Feed Wastage
// panel's "Issued vs Recorded" section) rather than gating what can be
// entered here. Kienyeji batches are unaffected — they keep selecting their
// own store-item-linked feed types elsewhere.
export const LAYER_FEED_TYPES = [
  { value: 'CHICK_MASH',     label: 'Chick Mash' },
  { value: 'CHICK_CRUMBS',   label: 'Chick Crumbs' },
  { value: 'GROWER_MASH',    label: "Grower's Mash" },
  { value: 'DEVELOPER_MASH', label: "Developer's Mash" },
  { value: 'PRELAYER_MASH',  label: "Prelayer's Mash" },
  { value: 'LAYER_MASH',     label: "Layer's Mash" },
] as const;

export type LayerFeedType = typeof LAYER_FEED_TYPES[number]['value'];
