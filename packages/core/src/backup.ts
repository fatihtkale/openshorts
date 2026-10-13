import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { Db } from './db/client'

/** Automatic snapshots kept; older automatic ones are removed. Manual and pre-restore snapshots are never removed. */
export const AUTO_BACKUPS_KEEP = 14
/** How old the newest automatic snapshot may get before the worker makes another. */
export const AUTO_BACKUP_EVERY_MS = 24 * 3_600_000

export const BACKUP_KINDS = ['auto', 'manual', 'before-restore'] as const
export type BackupKind = (typeof BACKUP_KINDS)[number]

export interface BackupInfo {
  name: string
  kind: BackupKind
  bytes: number
  createdAt: number
}

export function backupsDir(dataDir: string): string {
  return join(dataDir, 'backups')
}

const NAME = /^clipstudio-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)-(auto|manual|before-restore)\.db$/

function stamp(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
}

function parseName(name: string): { kind: BackupKind; createdAt: number } | null {
  const m = NAME.exec(name)
  if (!m) return null
  const iso = m[1]!.replace(/T(\d{2})-(\d{2})-(\d{2})Z/, 'T$1:$2:$3Z')
  return { kind: m[2] as BackupKind, createdAt: Date.parse(iso) }
}

/**
 * A consistent snapshot of the database (SQLite's online backup, safe while the app runs), plus the secret key
 * that encrypts account sign-ins and the Anthropic key; without it those can't be read after a restore.
 * Media files are not included (see `copyMedia`).
 */
export async function backupDatabase(db: Db, dataDir: string, kind: BackupKind, opts: { to?: string; now?: Date } = {}): Promise<BackupInfo & { path: string }> {
  const dir = opts.to ?? backupsDir(dataDir)
  await mkdir(dir, { recursive: true })
  const now = opts.now ?? new Date()
  const name = `clipstudio-${stamp(now)}-${kind}.db`
  const path = join(dir, name)
  await db.$client.backup(path)
  await copySecretKey(dataDir, dir)
  return { name, kind, path, bytes: (await stat(path)).size, createdAt: now.getTime() }
}

/** Copies data/secret.key next to the snapshots (once; it never changes). Not needed when SECRET_KEY is set in .env. */
async function copySecretKey(dataDir: string, dir: string): Promise<void> {
  const source = join(dataDir, 'secret.key')
  if (!existsSync(source)) return
  const target = join(dir, 'secret.key')
  if (existsSync(target) && (await readFile(target)).equals(await readFile(source))) return
  await copyFile(source, target)
}

export async function listBackups(dataDir: string, dir = backupsDir(dataDir)): Promise<BackupInfo[]> {
  if (!existsSync(dir)) return []
  const out: BackupInfo[] = []
  for (const name of await readdir(dir)) {
    const parsed = parseName(name)
    if (!parsed) continue
    out.push({ name, ...parsed, bytes: (await stat(join(dir, name))).size })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** Removes automatic snapshots beyond the newest `keep`. Returns the removed names. */
export async function pruneAutoBackups(dataDir: string, keep = AUTO_BACKUPS_KEEP): Promise<string[]> {
  const autos = (await listBackups(dataDir)).filter((b) => b.kind === 'auto')
  const old = autos.slice(keep)
  for (const b of old) await rm(join(backupsDir(dataDir), b.name), { force: true })
  return old.map((b) => b.name)
}

/** Makes an automatic snapshot when the newest one is older than a day; keeps the last 14. */
export async function autoBackup(db: Db, dataDir: string, now = new Date()): Promise<BackupInfo | null> {
  const newest = (await listBackups(dataDir)).find((b) => b.kind === 'auto')
  if (newest && now.getTime() - newest.createdAt < AUTO_BACKUP_EVERY_MS) return null
  const made = await backupDatabase(db, dataDir, 'auto', { now })
  await pruneAutoBackups(dataDir)
  return made
}

/** Checks that a file is a Clip Studio database before anything is replaced with it. */
export function checkBackupFile(path: string): { projects: number; clips: number } {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const tables = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((r) => (r as { name: string }).name))
    for (const t of ['projects', 'clips', 'jobs', '__drizzle_migrations']) {
      if (!tables.has(t)) throw new Error(`This file isn't a Clip Studio database (no "${t}" table).`)
    }
    const count = (t: string) => (db.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n
    return { projects: count('projects'), clips: count('clips') }
  } finally {
    db.close()
  }
}

/** Null when the SQLite module loads with this Node version, otherwise the reason (usually a Node version switch). */
export function sqliteProblem(): string | null {
  try {
    new Database(':memory:').close()
    return null
  } catch (error) {
    return (error as Error).message.split('\n')[0] ?? 'unknown error'
  }
}

/** Opens the database read-only for a health check: counts and the worker's last heartbeat (epoch ms). */
export function inspectDatabase(path: string): { projects: number; clips: number; workerAt: number | null } {
  const counts = checkBackupFile(path)
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const row = db.prepare("select value from settings where key = 'worker.heartbeat'").get() as { value: string } | undefined
    return { ...counts, workerAt: row ? ((JSON.parse(row.value) as { at?: number }).at ?? null) : null }
  } finally {
    db.close()
  }
}

/**
 * Replaces the database file with a snapshot. Only call this while the app is stopped; the caller makes a
 * before-restore snapshot first. Leftover WAL files of the old database are removed (their content is in the
 * before-restore snapshot), so SQLite doesn't replay them onto the restored file.
 */
export async function replaceDatabase(snapshot: string, dbPath: string): Promise<void> {
  checkBackupFile(snapshot)
  await rm(`${dbPath}-wal`, { force: true })
  await rm(`${dbPath}-shm`, { force: true })
  await copyFile(snapshot, dbPath)
}
