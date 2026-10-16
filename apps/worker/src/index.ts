import { spawn } from 'node:child_process'
import { hostname } from 'node:os'
import { socialApps } from '@clipstudio/social'
import {
  AccountService,
  aiCredentials,
  autoBackup,
  backupDatabase,
  ClipService,
  CompilationService,
  createDb,
  getConfig,
  JobQueue,
  loadSecretKey,
  LocalStorage,
  ModelService,
  PostService,
  ProjectService,
  ProposalService,
  RenderService,
  TranscriptService,
  setSetting,
  WORKER_HEARTBEAT_KEY,
  type WorkerHeartbeat,
} from '@clipstudio/core'
import { createGiveUpHook, createHandlers } from './handlers'
import { Worker } from './runner'

const config = getConfig()
const db = createDb({ path: config.dbPath, migrationsDir: config.migrationsDir })
const queue = new JobQueue(db)
const storage = new LocalStorage(config.storageDir)
const projects = new ProjectService(db, queue, storage)
const transcripts = new TranscriptService(db, queue)
const models = new ModelService(db, config.modelsDir)
const clips = new ClipService(db)
const secretKey = loadSecretKey(config.dataDir)
const deps = {
  queue,
  projects,
  transcripts,
  models,
  clips,
  proposals: new ProposalService(db, clips, projects),
  ai: () => aiCredentials(db, secretKey),
  backupNow: () => backupDatabase(db, config.dataDir, 'manual'),
  renders: new RenderService(db, queue),
  compilations: new CompilationService(db, queue),
  posts: new PostService(db, queue),
  accounts: new AccountService(db, secretKey),
  socialApps: socialApps(config),
  twitchApp: config.twitch,
  storage,
}
const workerId = `${hostname()}:${process.pid}`

const worker = new Worker({
  queue,
  handlers: createHandlers(deps),
  onGaveUp: createGiveUpHook(deps),
  workerId,
  concurrency: config.concurrency,
})

function beat(alive = true) {
  const value: WorkerHeartbeat = {
    workerId,
    pid: process.pid,
    at: alive ? Date.now() : 0,
    running: worker.runningCount,
    concurrency: config.concurrency,
  }
  setSetting(db, WORKER_HEARTBEAT_KEY, value)
}

// Keep the Mac awake while scheduled TikTok posts are coming up (TikTok can't schedule on its own).
// caffeinate -i stops idle sleep; a closed lid on battery still sleeps, which is why missed posts exist.
let caffeinate: ReturnType<typeof spawn> | null = null
function keepAwake() {
  if (process.platform !== 'darwin') return
  const upcoming = deps.posts.upcomingTiktok(Date.now() + 12 * 3_600_000)
  if (upcoming.length && !caffeinate) {
    caffeinate = spawn('caffeinate', ['-i', '-m', '-w', String(process.pid)], { stdio: 'ignore' })
    caffeinate.on('exit', () => (caffeinate = null))
    console.log(`[worker] keeping the Mac awake for ${upcoming.length} scheduled TikTok post(s)`)
  } else if (!upcoming.length && caffeinate) {
    caffeinate.kill()
    caffeinate = null
  }
}
const awakeTimer = setInterval(() => {
  try {
    keepAwake()
  } catch (error) {
    console.error('[worker] keep-awake check failed', error)
  }
}, 60_000)
keepAwake()

// A database snapshot a day (data/backups, last 14 kept); checked hourly so a Mac that was off catches up.
async function backupIfDue() {
  try {
    const made = await autoBackup(db, config.dataDir)
    if (made) console.log(`[worker] backed up the database to ${made.name}`)
  } catch (error) {
    console.error('[worker] automatic backup failed', error)
  }
}
const backupTimer = setInterval(() => void backupIfDue(), 3_600_000)
void backupIfDue()

worker.start()
beat()
const beatTimer = setInterval(beat, 5_000)
console.log(`[worker] ${workerId} ready (data: ${config.dataDir})`)

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[worker] ${signal}: stopping`)
  clearInterval(beatTimer)
  clearInterval(awakeTimer)
  clearInterval(backupTimer)
  caffeinate?.kill()
  await worker.stop()
  beat(false)
  db.$client.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
