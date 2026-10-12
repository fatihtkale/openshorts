import { eq } from 'drizzle-orm'
import type { Db } from './db/client'
import { settings } from './db/schema'

export function getSetting<T>(db: Db, key: string): T | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value as T | undefined
}

export function setSetting(db: Db, key: string, value: unknown): void {
  const updatedAt = new Date()
  db.insert(settings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
    .run()
}

export function deleteSetting(db: Db, key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run()
}

/** Written by the worker every few seconds so the app can tell whether it is running. */
export const WORKER_HEARTBEAT_KEY = 'worker.heartbeat'

export interface WorkerHeartbeat {
  workerId: string
  pid: number
  at: number
  running: number
  concurrency: Record<string, number>
}

/** The MCP client that last talked to the app: `{ name, lastSeen }`. */
export const MCP_CLIENT_KEY = 'mcp.client'
