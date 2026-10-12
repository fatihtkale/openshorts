import { spawn } from 'node:child_process'
import { hostname } from 'node:os'
import { socialApps } from '@clipstudio/social'
import {
  AccountService,
  ClipService,
  createDb,
  getConfig,
  JobQueue,
  loadSecretKey,
  LocalStorage,
  ModelService,
  PostService,
  ProjectService,
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
const deps = {
  projects,
  transcripts,
  models,
  clips: new ClipService(db),
  renders: new RenderService(db, queue),
  posts: new PostService(db, queue),
  accounts: new AccountService(db, loadSecretKey(config.dataDir)),
  socialApps: socialApps(config),
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
  caffeinate?.kill()
  await worker.stop()
  beat(false)
  db.$client.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
