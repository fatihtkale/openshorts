import { hostname } from 'node:os'
import {
  createDb,
  getConfig,
  JobQueue,
  LocalStorage,
  ModelService,
  ProjectService,
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
const deps = { projects, transcripts, models, storage }
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
  await worker.stop()
  beat(false)
  db.$client.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
