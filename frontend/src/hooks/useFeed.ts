import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useFeedStock() {
  return useQuery({
    queryKey: ['feed', 'stock'],
    queryFn: () => api.get('/feed/stock').then(r => r.data),
    refetchInterval: 30_000, // 30 seconds — picks up Store issue quickly
  });
}

export function useFeedDeliveries(days = 30) {
  return useQuery({
    queryKey: ['feed', 'deliveries', days],
    queryFn: () => api.get(`/feed/deliveries?days=${days}`).then(r => r.data),
    staleTime: 60_000,
  });
}

export function useLogFeedDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/feed/deliveries', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export function useLogFeedIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/feed/intake', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}
