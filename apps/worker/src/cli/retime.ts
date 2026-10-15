// pnpm retime [<projectId> …]
// Queues "line up words with the audio" for transcripts made before that step ran after every transcription.
// With no ids, every finished transcript. The worker does the work (start the app with pnpm dev).
import { createDb, getConfig, JobQueue, TranscriptService } from '@clipstudio/core'
import { ok, warn, workerAlive } from './shared'

const config = getConfig()
const db = createDb({ path: config.dbPath, migrationsDir: config.migrationsDir })
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const queue = new JobQueue(db)
const ready = new TranscriptService(db, queue).readyProjectIds()
const targets = ids.length ? ready.filter((id) => ids.includes(id)) : ready

for (const projectId of targets) queue.enqueue('transcript.retime', { projectId }, { projectId, createdBy: 'cli' })
ok(`Queued ${targets.length} transcript${targets.length === 1 ? '' : 's'} to line up with the audio`)
if (ids.length > targets.length) warn(`${ids.length - targets.length} id(s) have no finished transcript`)
if (!workerAlive(db)) warn('The worker is not running: start the app (pnpm dev) and they run then')
db.$client.close()
