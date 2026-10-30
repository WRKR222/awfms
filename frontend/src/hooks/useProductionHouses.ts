// src/hooks/useProductionHouses.ts
//
// Production houses (Block 1 / Block 2) and their maps. Records are kept per
// row · level (one unit per level, code BLK1-A1-L4, a level may hold several
// batches) plus the 8 isolation cages per house (BLK1-ISO-3). The physical
// arrangement (tiers × cages, 4 birds per cage) only sets each level's capacity.
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
  totalLevels: number;
  occupiedLevels: number;
  fullLevels: number;
  cagesPerLevel: number;
  birds: number;
  capacityBirds: number;
  freeSpaces: number;
  levelsPerRow: number;
  tiersPerLevel: number;
  cagesPerTier: number;
  birdsPerCage: number;
  isolationCageCount: number;
}

export interface UnitBatch {
  batchId: string;
  batchCode: string;
  birdCount: number;
  placedDate: string;
}

export interface LevelUnit {
  unitId: string;
  code: string;
  label: string;
  rowCode: string | null;
  level: number | null;
  capacity: number;
  birds: number;
  batches: UnitBatch[];
  mortality7d: number;
}

export interface IsolationUnit {
  unitId: string;
  code: string;
  label: string;
  cageNo: number;
  capacity: number;
  birds: number;
  batches: UnitBatch[];
  isolationReason: string | null;
  /** Where the birds were taken from. */
  origin: string | null;
  mortality7d: number;
}

export interface HouseMap {
  block: {
    id: string; code: HouseCode; name: string; isActive: boolean; isUnderConstruction: boolean;
    levelsPerRow: number; tiersPerLevel: number; cagesPerTier: number; birdsPerCage: number;
    cagesPerLevel: number; isolationCageCount: number;
  };
  sections: { code: string; rows: { rowId: string; rowCode: string; isActive: boolean }[] }[];
  levels: LevelUnit[];
  isolation: IsolationUnit[];
  batches: { id: string; batchCode: string; birds: number; levels: number; currentBirdCount: number }[];
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

export function levelCode(house: string, rowCode: string, level: number) {
  return `${house}-${rowCode}-L${level}`;
}
export function levelLabel(level: number, levels = 4) {
  if (level === 1) return 'Level 1 (Bottom)';
  if (level === levels) return `Level ${level} (Top)`;
  return `Level ${level}`;
}

/** Query keys to refresh after any write that changes the production map. */
export const HOUSE_QUERY_KEYS = [['production-houses'], ['production-house-map'], ['cage-map'], ['batches'], ['flock', 'batches']];
