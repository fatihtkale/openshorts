import { backupsDir, listBackups } from '@clipstudio/core'

/** Database snapshots in data/backups, newest first. */
export default defineEventHandler(async () => {
  const { config } = useCore()
  return { dir: backupsDir(config.dataDir), backups: (await listBackups(config.dataDir)).slice(0, 30), secretFromEnv: !!process.env.SECRET_KEY }
})
