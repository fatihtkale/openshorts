import {
  ClipService,
  createDb,
  getConfig,
  JobQueue,
  LocalStorage,
  ModelService,
  ProjectService,
  ProposalService,
  RenderService,
  TranscriptService,
  type AppConfig,
  type Db,
} from '@clipstudio/core'

interface Core {
  config: AppConfig
  db: Db
  queue: JobQueue
  storage: LocalStorage
  projects: ProjectService
  transcripts: TranscriptService
  models: ModelService
  clips: ClipService
  proposals: ProposalService
  renders: RenderService
}

// Kept on globalThis so dev-server hot reloads reuse one SQLite connection.
const holder = globalThis as typeof globalThis & { __clipstudioCore?: Core }

export function useCore(): Core {
  if (!holder.__clipstudioCore) {
    const config = getConfig()
    const db = createDb({ path: config.dbPath, migrationsDir: config.migrationsDir })
    const queue = new JobQueue(db)
    const storage = new LocalStorage(config.storageDir)
    const projects = new ProjectService(db, queue, storage)
    const clips = new ClipService(db)
    holder.__clipstudioCore = {
      config,
      db,
      queue,
      storage,
      projects,
      transcripts: new TranscriptService(db, queue),
      models: new ModelService(db, config.modelsDir),
      clips,
      proposals: new ProposalService(db, clips, projects),
      renders: new RenderService(db, queue),
    }
  }
  return holder.__clipstudioCore
}
