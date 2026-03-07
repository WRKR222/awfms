import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useFeedStock() {
  return useQuery({
    queryKey: ['feed', 'stock'],
    queryFn: () => api.get('/feed/stock').then(r => r.data),
    refetchInterval: 5 * 60 * 1000, // every 5 minutes
  });
}

export function useLogFeedIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/feed/intake', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}
