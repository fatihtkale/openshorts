// pnpm restore <snapshot.db | name in data/backups>
// Replaces the database with a snapshot, after a confirmation and a "before-restore" snapshot of the current state.
import { existsSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { backupDatabase, backupsDir, checkBackupFile, createDb, getConfig, listBackups, replaceDatabase } from '@clipstudio/core'
import { bad, ok, portInUse, userCwd, warn, workerAlive } from './shared'

const config = getConfig()
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'))

if (!arg) {
  const backups = await listBackups(config.dataDir)
  console.log('Usage: pnpm restore <snapshot>\n')
  console.log(backups.length ? 'Snapshots in data/backups (newest first):' : 'No snapshots in data/backups yet.')
  for (const b of backups.slice(0, 20)) console.log(`  ${b.name}  ${new Date(b.createdAt).toLocaleString()}`)
  process.exit(1)
}

const file = isAbsolute(arg) ? arg : existsSync(resolve(userCwd, arg)) ? resolve(userCwd, arg) : join(backupsDir(config.dataDir), arg)
if (!existsSync(file)) {
  bad(`No such file: ${file}`)
  process.exit(1)
}

let snapshot: { projects: number; clips: number }
try {
  snapshot = checkBackupFile(file)
} catch (error) {
  bad((error as Error).message)
  process.exit(1)
}

const db = createDb({ path: config.dbPath, migrationsDir: config.migrationsDir })
if (workerAlive(db) || (await portInUse(config.port))) {
  db.$client.close()
  bad('Clip Studio is running. Stop it first (Ctrl+C in the terminal running pnpm dev), then run this again.')
  process.exit(1)
}
const current = checkBackupFile(config.dbPath)

console.log(`\nRestore ${basename(file)}`)
console.log(`  Snapshot: ${snapshot.projects} projects, ${snapshot.clips} clips`)
console.log(`  Now:      ${current.projects} projects, ${current.clips} clips`)
console.log('  The current database is saved as a before-restore snapshot first. Media files are not touched;')
console.log('  projects whose files were deleted since the snapshot will show as missing.\n')
const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = (await rl.question('Type "restore" to continue: ')).trim()
rl.close()
if (answer !== 'restore') {
  console.log('Nothing changed.')
  db.$client.close()
  process.exit(0)
}

const before = await backupDatabase(db, config.dataDir, 'before-restore')
db.$client.close()
ok(`Saved the current state as ${before.name}`)
await replaceDatabase(file, config.dbPath)
ok('Database restored')

// Account sign-ins and the Anthropic key are encrypted with the secret key that was in use when they were saved.
const snapshotKey = join(dirname(file), 'secret.key')
const currentKey = join(config.dataDir, 'secret.key')
if (!process.env.SECRET_KEY && existsSync(snapshotKey)) {
  if (!existsSync(currentKey)) {
    await copyFile(snapshotKey, currentKey)
    ok('Secret key restored')
  } else if (!(await readFile(snapshotKey)).equals(await readFile(currentKey))) {
    warn(`The snapshot's secret.key differs from data/secret.key. If accounts ask to reconnect, copy ${snapshotKey} to data/secret.key.`)
  }
}
console.log('\nStart the app again with: pnpm dev')
