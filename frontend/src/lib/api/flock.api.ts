import apiClient from './client';

export const flockApi = {
  // Houses
  getHouses: async () => (await apiClient.get('/houses')).data,

  // Batches
  getBatches: async (params?: Record<string, string>) =>
    (await apiClient.get('/batches', { params })).data,

  getBatchById: async (id: string) =>
    (await apiClient.get(`/batches/${id}`)).data,

  createBatch: async (dto: Record<string, unknown>) =>
    (await apiClient.post('/batches', dto)).data,

  updateStage: async (id: string, stage: string) =>
    (await apiClient.patch(`/batches/${id}/stage`, { stage })).data,

  closeBatch: async (id: string) =>
    (await apiClient.post(`/batches/${id}/close`)).data,

  // Daily entries
  getEntries: async (batchId: string) =>
    (await apiClient.get(`/batches/${batchId}/entries`)).data,

  createFlockEntry: async (dto: Record<string, unknown>) =>
    (await apiClient.post('/flock-entries', dto)).data,

  verifyFlockEntry: async (id: string, notes?: string) =>
    (await apiClient.patch(`/flock-entries/${id}/verify`, { notes })).data,

  returnFlockEntry: async (id: string, rejectionNote: string) =>
    (await apiClient.patch(`/flock-entries/${id}/return`, { rejectionNote })).data,

  // Weight samples
  createWeightSample: async (dto: Record<string, unknown>) =>
    (await apiClient.post('/weight-samples', dto)).data,

  getWeightSamples: async (batchId: string) =>
    (await apiClient.get(`/weight-samples/${batchId}`)).data,

  // Verification queue
  getPendingQueue: async () =>
    (await apiClient.get('/verification/pending')).data,
};
