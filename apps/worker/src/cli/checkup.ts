// pnpm checkup: checks that this Mac can run Clip Studio, and says how to fix what's missing.
// Read-only: it never installs, downloads or changes anything (it doesn't even open the database for writing).
import { existsSync, statSync } from 'node:fs'
import { access, constants, mkdir, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { getConfig, inspectDatabase, listBackups, sqliteProblem, WHISPER_MODELS } from '@clipstudio/core'
import { checkTools, FACE_MODEL } from '@clipstudio/media'
import { checkTwitchApp } from '@clipstudio/social'
import { bad, hint, ok, portInUse, warn } from './shared'

let failures = 0
const fail = (s: string, fix?: string) => {
  failures++
  bad(s)
  if (fix) hint(fix)
}
const config = getConfig()

console.log('\nClip Studio checkup\n')

console.log('Runtime')
const [major, minor] = process.versions.node.split('.').map(Number) as [number, number]
if (major < 22) fail(`Node ${process.versions.node} is too old`, 'Install Node 24: brew install node@24 (or nvm install 24)')
else if (major === 22 && minor < 21) warn(`Node ${process.versions.node} works, but Nuxt wants 22.21+ or 24 (it prints a warning)`)
else ok(`Node ${process.versions.node}`)
if (existsSync(join(config.rootDir, 'node_modules'))) ok('Dependencies installed')
else fail('Dependencies are not installed', 'Run: pnpm install')
const sqlite = sqliteProblem()
if (sqlite) fail(`The database module doesn't load with Node ${process.versions.node} (${sqlite})`, 'Usually after switching Node versions. Run: pnpm fix:sqlite')
else ok('Database module loads')

console.log('\nTools')
for (const t of await checkTools()) {
  if (t.found) ok(`${t.name}${t.version ? ` ${t.version}` : ''}`)
  else fail(`${t.name} is missing (${t.purpose})`, t.installHint)
}

console.log('\nSettings (.env)')
if (existsSync(join(config.rootDir, '.env'))) ok('.env found')
else warn('No .env: defaults are used. Copy .env.example to .env to set posting accounts or a different data folder')
// Only whether something is set; values are never printed.
const set = (k: string) => !!process.env[k]
if (set('GOOGLE_CLIENT_ID') && set('GOOGLE_CLIENT_SECRET')) ok('YouTube app credentials set')
else warn('YouTube posting not set up (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET); see the Accounts page')
if (set('TIKTOK_CLIENT_KEY') && set('TIKTOK_CLIENT_SECRET')) ok('TikTok app credentials set')
else warn('TikTok posting not set up (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET); see the Accounts page')
if (config.twitch) {
  try {
    await checkTwitchApp(config.twitch)
    ok('Twitch app works (viewer clips and Smart import)')
  } catch (error) {
    fail(`Twitch app: ${(error as Error).message}`, 'Check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env (make a new secret on dev.twitch.tv if unsure)')
  }
} else warn('No Twitch app (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET): Twitch highlights use loudness only')
if (set('SECRET_KEY')) ok('Secret key from .env')
else if (existsSync(join(config.dataDir, 'secret.key'))) ok('Secret key in data/secret.key')
else ok('Secret key will be created on first start')

console.log('\nData')
try {
  await mkdir(config.dataDir, { recursive: true })
  await access(config.dataDir, constants.W_OK)
  const fs = await statfs(config.dataDir)
  const free = fs.bavail * fs.bsize
  const gb = (free / 1e9).toFixed(1)
  if (free < 5e9) fail(`Only ${gb} GB free where data lives (${config.dataDir})`, 'Free up space or set DATA_DIR in .env to a bigger disk')
  else if (free < 20e9) warn(`${gb} GB free: enough for a few long videos (${config.dataDir})`)
  else ok(`${gb} GB free in ${config.dataDir}`)
} catch {
  fail(`Can't write to ${config.dataDir}`, 'Check the folder permissions or set DATA_DIR in .env')
}

const installed = WHISPER_MODELS.filter((m) => {
  const file = join(config.modelsDir, m.file)
  return existsSync(file) && statSync(file).size === m.bytes
})
if (installed.length) ok(`Speech model: ${installed.map((m) => m.label).join(', ')}`)
else warn('No speech model yet: download one on the System check page (transcripts need it)')
if (existsSync(join(config.modelsDir, FACE_MODEL.file))) ok('Face model installed')
else ok('Face model downloads itself on first use (1.3 MB)')

if (existsSync(config.dbPath)) {
  try {
    const info = inspectDatabase(config.dbPath)
    ok(`Database: ${info.projects} project${info.projects === 1 ? '' : 's'}, ${info.clips} clip${info.clips === 1 ? '' : 's'}`)
    if (info.workerAt && Date.now() - info.workerAt < 20_000) ok('The app is running (worker heartbeat seen)')
  } catch (error) {
    fail(`The database can't be read: ${(error as Error).message}`, 'Restore a snapshot: pnpm restore')
  }
  const backups = await listBackups(config.dataDir)
  const newest = backups[0]
  if (!newest) warn('No backups yet: the app makes one a day while it runs, or run pnpm backup')
  else {
    const days = (Date.now() - newest.createdAt) / 86_400_000
    if (days > 3) warn(`Newest backup is ${Math.floor(days)} days old: run pnpm backup`)
    else ok(`Newest backup: ${new Date(newest.createdAt).toLocaleString()} (${backups.length} in data/backups)`)
  }
} else {
  ok('No database yet: it is created on first start')
}

console.log('\nNetwork')
if (await portInUse(config.port)) ok(`Something answers on port ${config.port} (the app, if you started it)`)
else ok(`Port ${config.port} is free`)

console.log(failures ? `\n${failures} problem${failures === 1 ? '' : 's'} to fix before Clip Studio can run.\n` : '\nAll good. Start with: pnpm dev\n')
process.exit(failures ? 1 : 0)
