// src/hooks/useBrooderCageMap.ts
// CHANGES: BrooderLevelData extended with dailyRationKg, dispensedKgToday,
// and hylineWeek — new fields returned by the updated getCageMap() endpoint.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrooderLevelData {
  levelId:     string;
  levelNumber: number;
  label:       string;
  isActive:    boolean;
  assignment: {
    batchId:    string;
    birdCount:  number;
    placedDate: string;
    notes:      string | null;
  } | null;
  batch: {
    batchCode:        string;
    strain:           string;
    stage:            string;
    ageWeeks:         number;
    quantityReceived: number;
    dateOfHatch:      string;   // ISO date string — used for early-phase detection in feed log modal
  } | null;
  // Feed control fields (new — from HyLine standard lookup)
  hylineWeek:          number | null;   // HyLine week for this batch's age
  dailyRationKg:       number | null;   // g/bird/day × birdCount / 1000
  requiredKgThisWeek:  number | null;
  dispensedKgThisWeek: number;
  dispensedKgToday:    number;          // NEW — for over-issue guard in modal
  feedVariancePercent: number | null;
  // Weight control — latest sample logged against this row/level this week.
  weightCheck: {
    sampleDate:     string;
    averageWeightG: number;
    ageWeeks:       number;
    minG:           number;
    maxG:           number;
    withinBounds:   boolean;
  } | null;
}

export interface BrooderRowData {
  rowId:     string;
  rowNumber: number;
  label:     string;
  isActive:  boolean;
  birdTotal: number;
  heatToday: {
    id:            string;
    sourceType:    'CHARCOAL' | 'HEAT_BULB';
    charcoalKg:    number | null;
    bulbStartedAt: string | null;
    bulbStoppedAt: string | null;
    bulbMinutesOn: number | null;
    bulbCount:     number | null;
    isRunning:     boolean;
  } | null;
  levels: BrooderLevelData[];
}

export interface BrooderCageMapResponse {
  rows:        BrooderRowData[];
  totalChicks: number;
  generatedAt: string;
}

export interface FeedRequirementLevel {
  levelId:             string;
  levelNumber:         number;
  label:               string;
  batchCode:           string | null;
  birdCount:           number;
  hylineWeek:          number | null;
  dailyRationKg:       number | null;
  requiredKgThisWeek:  number | null;
  dispensedKgThisWeek: number;
  dispensedKgToday:    number;
  feedVariancePercent: number | null;
  exactMatch:          boolean;
}

export interface FeedRequirementRow {
  rowId:               string;
  rowNumber:           number;
  label:               string;
  birdTotal:           number;
  requiredKgThisWeek:  number;
  dispensedKgThisWeek: number;
  exactMatch:          boolean;
  levels:              FeedRequirementLevel[];
}

export interface FeedRequirementSummary {
  weekStart:                string;
  totalChicks:              number;
  totalRequiredKgThisWeek:  number;
  totalDispensedKgThisWeek: number;
  residualCarryForwardKg:   number;  // NEW — from last approved issuance plan
  netToIssueKg:             number;  // NEW — required - residual
  rows:                     FeedRequirementRow[];
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useBrooderCageMap() {
  return useQuery<BrooderCageMapResponse>({
    queryKey:      ['brooder-cage-map'],
    queryFn:       () => api.get('/brooder/cage-map').then(r => r.data),
    staleTime:     30_000,
    refetchInterval: 60_000,
  });
}

/** Lightweight grid for registration/assignment modals (no feed/heat data). */
export interface BrooderLevelSummary {
  levelId:          string;
  levelNumber:      number;
  label:            string;
  isOccupied:       boolean;
  currentBirdCount: number;
}

export interface BrooderRowSummary {
  rowId:     string;
  rowNumber: number;
  label:     string;
  levels:    BrooderLevelSummary[];
}

export function useBrooderRowsAndLevels(enabled = true) {
  return useQuery<BrooderRowSummary[]>({
    queryKey:  ['brooder-rows-and-levels'],
    queryFn:   () => api.get('/brooder/rows-and-levels').then(r => r.data),
    staleTime: 30_000,
    enabled,
  });
}

export function useBrooderFeedSummary() {
  return useQuery<FeedRequirementSummary>({
    queryKey:      ['brooder-feed-summary'],
    queryFn:       () => api.get('/brooder/feed-requirement-summary').then(r => r.data),
    staleTime:     30_000,
    refetchInterval: 60_000,
  });
}

// ── Missed-feed alerts (yesterday's ration not fully given) ────────────────

export interface MissedFeedAlert {
  levelId:     string;
  levelLabel:  string;
  rowId:       string;
  rowLabel:    string;
  batchId:     string;
  batchCode:   string;
  date:        string;
  requiredKg:  number;
  dispensedKg: number;
  shortfallKg: number;
}

export interface MissedFeedAlertsResponse {
  date:       string;
  alertCount: number;
  alerts:     MissedFeedAlert[];
}

export function useMissedFeedAlerts() {
  return useQuery<MissedFeedAlertsResponse>({
    queryKey:      ['brooder-missed-feed-alerts'],
    queryFn:       () => api.get('/brooder/missed-feed-alerts').then(r => r.data),
    staleTime:     60_000,
    refetchInterval: 5 * 60_000,
  });
}

// ── Daily feed breakdown (calendar week, for PM analysis) ───────────────────

export interface DailyFeedBreakdownDay {
  date:        string;
  dayLabel:    string;
  dispensedKg: number;
  skipped:     boolean;
}

export interface DailyFeedBreakdownResponse {
  weekStart:   string;
  days:        DailyFeedBreakdownDay[];
  totalKg:     number;
  skippedDays: string[];
}

export function useDailyFeedBreakdown() {
  return useQuery<DailyFeedBreakdownResponse>({
    queryKey:      ['brooder-daily-feed-breakdown'],
    queryFn:       () => api.get('/brooder/daily-feed-breakdown').then(r => r.data),
    staleTime:     60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useAssignBrooderLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ levelId, data }: { levelId: string; data: any }) =>
      api.post(`/brooder/levels/${levelId}/assign`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-rows-and-levels'] }); // FIX: keep source dropdown in sync
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}

export function useRemoveBrooderLevelAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (levelId: string) =>
      api.delete(`/brooder/levels/${levelId}/assign`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-rows-and-levels'] }); // FIX: keep source dropdown in sync
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}

export function useCreateBrooderHeatLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      api.post('/brooder/heat-logs', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
    },
  });
}

export function useStopBrooderHeatLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.patch(`/brooder/heat-logs/${id}/stop`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
    },
  });
}

/** Mutation: log mortality/culling on a specific level (Req 1). */
export function useCreateBrooderMortalityLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      levelId:        string;
      batchId:        string;
      logDate:        string;
      mortalityCount: number;
      cullingCount:   number;
      cause?:         string;
      notes?:         string;
    }) => api.post('/brooder/mortality-logs', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}

/** Mutation: log a weight sample (Req 6 + Req 7).
 *  Preferred: pass levelId to log against a specific occupied row/level —
 *  the service derives batchId from that level's active assignment. */
export function useCheckBrooderWeightSample() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      levelId?:     string;
      batchId?:     string;
      sampleDate:   string;
      sampleCount:  number;
      totalWeightG: number;
      notes?:       string;
    }) => api.post('/brooder/weight-samples', data).then(r => r.data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['brooder-weight-history'] });
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      if (variables.levelId) {
        qc.invalidateQueries({ queryKey: ['brooder-level-weight-history', variables.levelId] });
      }
    },
  });
}

/** Weight history scoped to a specific occupied row/level. */
export interface LevelWeightSample {
  id:             string;
  sampleDate:     string;
  sampleCount:    number;
  totalWeightG:   number;
  averageWeightG: number;
  ageWeeks:       number;
  notes:          string | null;
  standard:       { week: number; minG: number; maxG: number; phase: string };
  withinBounds:   boolean;
}

export function useLevelWeightHistory(levelId: string | null) {
  return useQuery<LevelWeightSample[]>({
    queryKey:  ['brooder-level-weight-history', levelId],
    queryFn:   () => api.get(`/brooder/levels/${levelId}/weight-history`).then(r => r.data),
    enabled:   !!levelId,
    staleTime: 30_000,
  });
}
