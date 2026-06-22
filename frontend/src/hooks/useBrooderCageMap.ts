// src/hooks/useBrooderCageMap.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api/client';

// ── Types ─────────────────────────────────────────────────────────────────

export interface BrooderLevelData {
  levelId: string;
  levelNumber: number;
  label: string;
  isActive: boolean;
  assignment: {
    batchId: string;
    birdCount: number;
    placedDate: string;
    notes: string | null;
  } | null;
  batch: {
    batchCode: string;
    strain: string;
    stage: string;
    ageWeeks: number;
  } | null;
  feedType: string | null;
  requiredKgThisWeek: number | null;
  dispensedKgThisWeek: number;
  feedVariancePercent: number | null;
}

export interface BrooderRowData {
  rowId: string;
  rowNumber: number;
  label: string;
  isActive: boolean;
  birdTotal: number;
  heatToday: {
    id: string;
    sourceType: 'CHARCOAL' | 'HEAT_BULB';
    charcoalKg: number | null;
    bulbStartedAt: string | null;
    bulbStoppedAt: string | null;
    bulbMinutesOn: number | null;
    bulbCount: number | null;
    isRunning: boolean;
  } | null;
  levels: BrooderLevelData[];
}

export interface BrooderCageMapResponse {
  rows: BrooderRowData[];
  totalChicks: number;
  generatedAt: string;
}

export interface FeedRequirementLevel {
  levelId: string;
  levelNumber: number;
  label: string;
  batchCode: string | null;
  birdCount: number;
  feedType: string | null;
  requiredKgThisWeek: number | null;
  dispensedKgThisWeek: number;
  feedVariancePercent: number | null;
  exactMatch: boolean;
}

export interface FeedRequirementRow {
  rowId: string;
  rowNumber: number;
  label: string;
  birdTotal: number;
  requiredKgThisWeek: number;
  dispensedKgThisWeek: number;
  exactMatch: boolean;
  levels: FeedRequirementLevel[];
}

export interface FeedRequirementSummary {
  weekStart: string;
  totalChicks: number;
  totalRequiredKgThisWeek: number;
  totalDispensedKgThisWeek: number;
  rows: FeedRequirementRow[];
}

// ── Queries ──────────────────────────────────────────────────────────────

export function useBrooderCageMap() {
  return useQuery<BrooderCageMapResponse>({
    queryKey: ['brooder', 'cage-map'],
    queryFn: () => api.get('/brooder/cage-map').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useBrooderFeedRequirement() {
  return useQuery<FeedRequirementSummary>({
    queryKey: ['brooder', 'feed-requirement-summary'],
    queryFn: () => api.get('/brooder/feed-requirement-summary').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useBrooderHeatLogs(rowId: string | null) {
  return useQuery({
    queryKey: ['brooder', 'heat-logs', rowId],
    queryFn: () => api.get(`/brooder/rows/${rowId}/heat-logs`).then(r => r.data),
    enabled: !!rowId,
    staleTime: 15_000,
  });
}

export function useBrooderLevelFeedLogs(levelId: string | null) {
  return useQuery({
    queryKey: ['brooder', 'level-feed-logs', levelId],
    queryFn: () => api.get(`/brooder/levels/${levelId}/feed-logs`).then(r => r.data),
    enabled: !!levelId,
    staleTime: 15_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['brooder'] });
  qc.invalidateQueries({ queryKey: ['batches'] });
  qc.invalidateQueries({ queryKey: ['brooder-summary'] });
  qc.invalidateQueries({ queryKey: ['feed'] });
}

export function useAssignBrooderLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ levelId, data }: { levelId: string; data: any }) =>
      api.post(`/brooder/levels/${levelId}/assign`, data).then(r => r.data),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRemoveBrooderLevelAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (levelId: string) =>
      api.delete(`/brooder/levels/${levelId}/assign`).then(r => r.data),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useLogCharcoalHeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { rowId: string; logDate: string; charcoalKg: number; notes?: string }) =>
      api.post('/brooder/heat-logs', { ...data, sourceType: 'CHARCOAL' }).then(r => r.data),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useStartBulbHeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { rowId: string; logDate: string; bulbCount?: number; notes?: string }) =>
      api.post('/brooder/heat-logs', { ...data, sourceType: 'HEAT_BULB' }).then(r => r.data),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useStopBulbHeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ heatLogId, notes }: { heatLogId: string; notes?: string }) =>
      api.patch(`/brooder/heat-logs/${heatLogId}/stop`, { notes }).then(r => r.data),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useLogLevelFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      levelId: string; feedType: string; entryDate: string;
      quantityDispensedKg: number; notes?: string;
    }) => api.post('/brooder/feed-logs', data).then(r => r.data),
    onSuccess: () => invalidateAll(qc),
  });
}
