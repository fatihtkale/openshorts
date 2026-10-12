import { createDb, getConfig, JobQueue, LocalStorage, ProjectService, type AppConfig, type Db } from '@clipstudio/core'

interface Core {
  config: AppConfig
  db: Db
  queue: JobQueue
  storage: LocalStorage
  projects: ProjectService
}

// Kept on globalThis so dev-server hot reloads reuse one SQLite connection.
const holder = globalThis as typeof globalThis & { __clipstudioCore?: Core }

export function useCore(): Core {
  if (!holder.__clipstudioCore) {
    const config = getConfig()
    const db = createDb({ path: config.dbPath, migrationsDir: config.migrationsDir })
    const queue = new JobQueue(db)
    const storage = new LocalStorage(config.storageDir)
    holder.__clipstudioCore = {
      config,
      db,
      queue,
      storage,
      projects: new ProjectService(db, queue, storage),
    }
  }
  return holder.__clipstudioCore
}
