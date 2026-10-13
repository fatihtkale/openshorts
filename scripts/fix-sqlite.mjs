// pnpm fix:sqlite: fetches the ready-made better-sqlite3 build for the Node version you're running now.
// Needed after switching Node (e.g. 22 → 24): the database module is compiled for one Node version.
// `pnpm rebuild` doesn't redo it, and compiling it ourselves would need Xcode.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fromCore = createRequire(join(root, 'packages/core/package.json'))
const sqliteDir = dirname(fromCore.resolve('better-sqlite3/package.json'))
const prebuild = join(dirname(createRequire(join(sqliteDir, 'package.json')).resolve('prebuild-install/package.json')), 'bin.js')

console.log(`Fetching better-sqlite3 for Node ${process.version}…`)
const run = spawnSync(process.execPath, [prebuild], { cwd: sqliteDir, stdio: 'inherit' })
if (run.status !== 0) process.exit(run.status ?? 1)
try {
  const Database = fromCore('better-sqlite3')
  new Database(':memory:').close()
  console.log(`✓ The database module works with Node ${process.version}. Start the app with: pnpm dev`)
} catch (error) {
  console.error(`✗ Still not loading: ${error.message}`)
  process.exit(1)
}
