/** Worker heartbeat status, shared by every component that asks for it (same useFetch key). */
export function useWorkerStatus() {
  return useFetch('/api/worker', { key: 'worker-status', server: false })
}
