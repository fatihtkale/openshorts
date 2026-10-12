import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

export interface AppConfig {
  rootDir: string
  dataDir: string
  dbPath: string
  storageDir: string
  modelsDir: string
  migrationsDir: string
  host: string
  port: number
  /** Where the app is reached, for OAuth redirects and links. */
  appUrl: string
  /** Platform app credentials from .env; null when not set up. */
  social: {
    youtube: { clientId: string; clientSecret: string } | null
    tiktok: { clientId: string; clientSecret: string } | null
  }
  /** Max jobs running at once per concurrency group. Unlisted groups use `default`. */
  concurrency: Record<string, number>
}

/** Heavy groups run one at a time on a 16 GB machine unless overridden with WORKER_CONCURRENCY_<GROUP>. */
const DEFAULT_CONCURRENCY: Record<string, number> = {
  default: 2,
  download: 2,
  media: 1,
  upload: 1,
  transcribe: 1,
  render: 1,
}

/** Walks up from `start` to the directory holding pnpm-workspace.yaml. */
export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return resolve(start)
    dir = parent
  }
}

function loadEnvFile(rootDir: string) {
  const file = resolve(rootDir, '.env')
  if (existsSync(file)) process.loadEnvFile(file)
}

function readConcurrency(): Record<string, number> {
  const result = { ...DEFAULT_CONCURRENCY }
  for (const [key, value] of Object.entries(process.env)) {
    const match = /^WORKER_CONCURRENCY_([A-Z0-9_]+)$/.exec(key)
    const n = Number(value)
    if (match?.[1] && Number.isInteger(n) && n > 0) result[match[1].toLowerCase()] = n
  }
  return result
}

let cached: AppConfig | undefined

export function getConfig(): AppConfig {
  if (cached) return cached
  const rootDir = process.env.CLIPSTUDIO_ROOT ?? findRepoRoot()
  loadEnvFile(rootDir)

  const rawDataDir = process.env.DATA_DIR ?? './data'
  const dataDir = isAbsolute(rawDataDir) ? rawDataDir : resolve(rootDir, rawDataDir)

  cached = {
    rootDir,
    dataDir,
    dbPath: resolve(dataDir, 'clipstudio.db'),
    storageDir: resolve(dataDir, 'storage'),
    modelsDir: resolve(dataDir, 'models'),
    migrationsDir: resolve(rootDir, 'packages/core/drizzle'),
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
    appUrl: process.env.APP_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`,
    social: {
      youtube:
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
          ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
          : null,
      tiktok:
        process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET
          ? { clientId: process.env.TIKTOK_CLIENT_KEY, clientSecret: process.env.TIKTOK_CLIENT_SECRET }
          : null,
    },
    concurrency: readConcurrency(),
  }
  return cached
}
