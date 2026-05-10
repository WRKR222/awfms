import apiClient from './client';

export const flockApi = {
  getHouses: async (birdType?: string) =>
    (await apiClient.get('/flock/houses', { params: birdType ? { birdType } : undefined })).data,
  getBatches: async (params?: Record<string, string>) =>
    (await apiClient.get('/flock/batches', { params })).data,
  getBatchById: async (id: string) =>
    (await apiClient.get(`/flock/batches/${id}`)).data,
  createBatch: async (dto: Record<string, unknown>) =>
    (await apiClient.post('/flock/batches', dto)).data,
  closeBatch: async (id: string) =>
    (await apiClient.patch(`/flock/batches/${id}/stage`, { stage: 'CLOSED' })).data,
  updateStage: async (id: string, stage: string, rowPlacements?: Array<{ rowId: string; birdCount: number }>) =>
    (await apiClient.patch(`/flock/batches/${id}/stage`, { stage, rowPlacements })).data,
  getEntries: async (batchId: string, limit?: number) =>
    (await apiClient.get(`/flock/batches/${batchId}/entries`, { params: limit ? { limit } : undefined })).data,
  getPendingQueue: async () =>
    (await apiClient.get('/flock/entries/pending')).data,
  createFlockEntry: async (dto: Record<string, unknown>) =>
    (await apiClient.post('/flock/entries', dto)).data,
  verifyFlockEntry: async (id: string, body?: Record<string, unknown>) =>
    (await apiClient.patch(`/flock/entries/${id}/verify`, body ?? {})).data,
  returnFlockEntry: async (id: string, returnReason: string) =>
    (await apiClient.patch(`/flock/entries/${id}/return`, { returnReason })).data,
  createWeightSample: async (dto: Record<string, unknown>) =>
    (await apiClient.post('/flock/weight-samples', dto)).data,
  getWeightSamples: async (batchId: string) =>
    (await apiClient.get(`/flock/weight-samples/${batchId}`)).data,
};
