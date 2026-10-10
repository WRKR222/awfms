// src/hooks/useProductionHouses.ts
//
// Production houses (Block 1 / Block 2) and their per-cage maps. The server
// only returns OCCUPIED cages; the full grid is built here from the block's
// dimensions (rows × 4 levels × tiers × 4 cages + isolation cages), using the
// same deterministic cage codes the backend uses (BLK1-A1-L4-T07-C2).
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api/client';

export type HouseCode = 'BLK1' | 'BLK2';
export const HOUSES: { code: HouseCode; block: 'BLOCK1' | 'BLOCK2'; label: string }[] = [
  { code: 'BLK1', block: 'BLOCK1', label: 'Block 1' },
  { code: 'BLK2', block: 'BLOCK2', label: 'Block 2' },
];

export interface HouseSummary {
  code: HouseCode;
  name: string;
  isActive: boolean;
  totalCages: number;
  occupiedCages: number;
  emptyCages: number;
  birds: number;
  capacityBirds: number;
  freeSpaces: number;
  levelsPerRow: number;
  tiersPerLevel: number;
  cagesPerTier: number;
  birdsPerCage: number;
  isolationCageCount: number;
}

export interface OccupiedCage {
  cageId: string;
  code: string;
  label: string;
  rowCode: string | null;
  level: number | null;
  tier: number | null;
  cage: number;
  isIsolation: boolean;
  capacity: number;
  batchId: string;
  batchCode: string;
  birdCount: number;
  isolationReason: string | null;
  placedDate: string;
  mortality7d: number;
}

export interface HouseMap {
  block: {
    id: string; code: HouseCode; name: string; isActive: boolean; isUnderConstruction: boolean;
    levelsPerRow: number; tiersPerLevel: number; cagesPerTier: number; birdsPerCage: number;
    isolationCageCount: number;
  };
  sections: { code: string; rows: { rowId: string; rowCode: string; isActive: boolean }[] }[];
  occupied: OccupiedCage[];
  batches: { id: string; batchCode: string; birds: number; cages: number; currentBirdCount: number }[];
  totals: HouseSummary;
}

export function useProductionHouses(enabled = true) {
  return useQuery<HouseSummary[]>({
    queryKey: ['production-houses'],
    queryFn: () => api.get('/production/houses').then(r => r.data),
    staleTime: 30_000,
    enabled,
  });
}

export function useHouseMap(code: HouseCode | null) {
  return useQuery<HouseMap>({
    queryKey: ['production-house-map', code],
    queryFn: () => api.get(`/production/houses/${code}/map`).then(r => r.data),
    enabled: !!code,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function cageCode(house: string, rowCode: string, level: number, tier: number, cage: number) {
  return `${house}-${rowCode}-L${level}-T${pad2(tier)}-C${cage}`;
}
export function isolationCode(house: string, n: number) {
  return `${house}-ISO-${n}`;
}
export function levelLabel(level: number, levels = 4) {
  if (level === 1) return 'Level 1 (Bottom)';
  if (level === levels) return `Level ${level} (Top)`;
  return `Level ${level}`;
}
export function cageLabel(rowCode: string, level: number, tier: number, cage: number) {
  return `${rowCode} · ${levelLabel(level)} · Tier ${pad2(tier)} · Cage ${cage}`;
}

/** Query keys to refresh after any write that changes cages. */
export const HOUSE_QUERY_KEYS = [['production-houses'], ['production-house-map'], ['cage-map'], ['batches'], ['flock', 'batches']];
