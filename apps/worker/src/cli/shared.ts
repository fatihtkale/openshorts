import { createConnection } from 'node:net'
import { getSetting, WORKER_HEARTBEAT_KEY, type Db, type WorkerHeartbeat } from '@clipstudio/core'

export const ok = (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`)
export const warn = (s: string) => console.log(`  \x1b[33m!\x1b[0m ${s}`)
export const bad = (s: string) => console.log(`  \x1b[31m✗\x1b[0m ${s}`)
export const hint = (s: string) => console.log(`      ${s}`)
export const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`

/** True when something answers on the app's port. */
export function portInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(1_000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

/** The worker wrote a heartbeat in the last 20 s. */
export function workerAlive(db: Db): boolean {
  const beat = getSetting<WorkerHeartbeat>(db, WORKER_HEARTBEAT_KEY)
  return !!beat && Date.now() - beat.at < 20_000
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

export function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Where the user ran the command (pnpm runs scripts from the package folder and keeps the original in INIT_CWD). */
export const userCwd = process.env.INIT_CWD ?? process.cwd()
