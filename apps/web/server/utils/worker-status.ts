import { getSetting, WORKER_HEARTBEAT_KEY, type WorkerHeartbeat } from '@clipstudio/core'

/** The worker writes a heartbeat every 5 s; three missed beats means it's not running. */
const OFFLINE_AFTER_MS = 15_000

export function readWorkerStatus() {
  const beat = getSetting<WorkerHeartbeat>(useCore().db, WORKER_HEARTBEAT_KEY)
  const online = !!beat && Date.now() - beat.at < OFFLINE_AFTER_MS
  return {
    online,
    lastSeen: beat?.at || null,
    running: online ? beat!.running : 0,
    concurrency: beat?.concurrency ?? null,
  }
}
