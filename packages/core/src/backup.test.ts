import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { autoBackup, backupDatabase, backupsDir, checkBackupFile, inspectDatabase, listBackups, pruneAutoBackups, replaceDatabase } from './backup'
import { findRepoRoot } from './config'
import { createDb, type Db } from './db/client'
import { setSetting } from './settings'

const migrationsDir = resolve(findRepoRoot(), 'packages/core/drizzle')
let dataDir: string
let db: Db

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'clipstudio-backup-'))
  db = createDb({ path: join(dataDir, 'clipstudio.db'), migrationsDir })
  await writeFile(join(dataDir, 'secret.key'), 'k'.repeat(44))
})
afterEach(async () => {
  db.$client.close()
  await rm(dataDir, { recursive: true, force: true })
})

describe('backups', () => {
  it('snapshots the database with the secret key and lists the snapshots newest first', async () => {
    setSetting(db, 'marker', 'one')
    const first = await backupDatabase(db, dataDir, 'manual', { now: new Date('2026-10-01T10:00:00Z') })
    const second = await backupDatabase(db, dataDir, 'auto', { now: new Date('2026-10-02T10:00:00Z') })
    expect(first.name).toBe('clipstudio-2026-10-01T10-00-00Z-manual.db')
    expect(existsSync(join(backupsDir(dataDir), 'secret.key'))).toBe(true)
    expect((await listBackups(dataDir)).map((b) => [b.name, b.kind])).toEqual([
      [second.name, 'auto'],
      [first.name, 'manual'],
    ])
    expect(checkBackupFile(first.path)).toEqual({ projects: 0, clips: 0 })
    expect(inspectDatabase(join(dataDir, 'clipstudio.db'))).toMatchObject({ projects: 0, workerAt: null })
  })

  it('makes an automatic snapshot at most once a day and keeps the newest 14 automatic ones', async () => {
    const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 9))
    expect(await autoBackup(db, dataDir, day(0))).not.toBeNull()
    expect(await autoBackup(db, dataDir, new Date(day(0).getTime() + 3_600_000))).toBeNull()
    for (let n = 1; n <= 15; n++) await autoBackup(db, dataDir, day(n))
    await backupDatabase(db, dataDir, 'manual', { now: day(0) })
    const kept = await listBackups(dataDir)
    expect(kept.filter((b) => b.kind === 'auto')).toHaveLength(14)
    // The oldest automatic ones went; the manual one stays however old it is.
    expect(kept.at(-1)!.kind).toBe('manual')
    expect(await pruneAutoBackups(dataDir, 14)).toEqual([])
  })

  it('restores a snapshot over the database, dropping the old WAL', async () => {
    setSetting(db, 'marker', 'before')
    const snap = await backupDatabase(db, dataDir, 'manual')
    setSetting(db, 'marker', 'after')
    db.$client.close()

    await replaceDatabase(snap.path, join(dataDir, 'clipstudio.db'))
    db = createDb({ path: join(dataDir, 'clipstudio.db'), migrationsDir })
    const row = db.$client.prepare("select value from settings where key = 'marker'").get() as { value: string }
    expect(JSON.parse(row.value)).toBe('before')
  })

  it('refuses files that are not Clip Studio databases', async () => {
    const other = new Database(join(dataDir, 'other.db'))
    other.exec('create table notes (id integer primary key)')
    other.close()
    expect(() => checkBackupFile(join(dataDir, 'other.db'))).toThrow(/isn't a Clip Studio database/)
    await expect(replaceDatabase(join(dataDir, 'other.db'), join(dataDir, 'clipstudio.db'))).rejects.toThrow()
    expect((await readdir(dataDir)).includes('clipstudio.db')).toBe(true)
  })
})
