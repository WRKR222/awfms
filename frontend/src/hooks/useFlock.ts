import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api/client';

export function usePendingEntries() {
  return useQuery({
    queryKey: ['flock', 'entries', 'pending'],
    queryFn: () => api.get('/flock/entries/pending').then(r => r.data),
    refetchInterval: 60000, // refresh every minute
  });
}

export function useBatches(filters?: { isActive?: boolean; houseId?: string }) {
  return useQuery({
    queryKey: ['flock', 'batches', filters],
    queryFn: () => api.get('/flock/batches', { params: filters }).then(r => r.data),
  });
}

export function useBatch(id: string) {
  return useQuery({
    queryKey: ['flock', 'batches', id],
    queryFn: () => api.get(`/flock/batches/${id}`).then(r => r.data),
    enabled: !!id,
  });
}

export function useUpdateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.patch(`/flock/batches/${id}`, data).then(r => r.data),
    onSuccess: () => {
      // Two cache keys are in play across the app for the same batch data —
      // 'flock'/'batches' (useBatches/useBatch) and the raw 'batches' key used
      // by the Brooder pages — invalidate both so every screen stays in sync.
      qc.invalidateQueries({ queryKey: ['flock', 'batches'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}

export function useCreateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/flock/entries', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flock'] });
    },
  });
}

export function useVerifyEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.patch(`/flock/entries/${id}/verify`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flock', 'entries', 'pending'] });
    },
  });
}
