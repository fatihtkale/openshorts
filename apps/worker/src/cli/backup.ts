// pnpm backup [--to <folder>] [--media]
// A snapshot of the database and secret key; --media also copies every project's files (APFS clones on the same disk).
import { constants } from 'node:fs'
import { cp } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { backupDatabase, backupsDir, createDb, getConfig } from '@clipstudio/core'
import { flag, mb, ok, option, userCwd } from './shared'

const config = getConfig()
const target = option('to')
const to = target ? (isAbsolute(target) ? target : resolve(userCwd, target)) : backupsDir(config.dataDir)
const db = createDb({ path: config.dbPath, migrationsDir: config.migrationsDir })

console.log(`Backing up to ${to}`)
const made = await backupDatabase(db, config.dataDir, 'manual', { to })
db.$client.close()
ok(`Database: ${made.name} (${mb(made.bytes)})`)
if (process.env.SECRET_KEY) ok('Secret key: comes from SECRET_KEY in .env; keep a copy of .env somewhere safe')
else ok('Secret key: secret.key copied next to it')

if (flag('media')) {
  const folder = join(to, made.name.replace(/\.db$/, '-storage'))
  console.log('Copying media files (this can take a while for big projects)…')
  await cp(config.storageDir, folder, { recursive: true, mode: constants.COPYFILE_FICLONE })
  ok(`Media: ${folder}`)
} else {
  console.log('\nMedia files (videos, exports) were not copied; add --media, ideally with --to an external drive.')
}
console.log(`\nRestore later with: pnpm restore ${join(to, made.name)}`)
