import { mkdir, statfs } from 'node:fs/promises'
import { checkTools } from '@clipstudio/media'

export default defineEventHandler(async () => {
  const { config } = useCore()
  await mkdir(config.dataDir, { recursive: true })
  const [tools, fsStats] = await Promise.all([checkTools(), statfs(config.dataDir)])
  return {
    tools,
    models: listModelsWithDownloads(),
    worker: readWorkerStatus(),
    storage: {
      dataDir: config.dataDir,
      freeBytes: fsStats.bavail * fsStats.bsize,
      totalBytes: fsStats.blocks * fsStats.bsize,
    },
    node: process.version,
  }
})
