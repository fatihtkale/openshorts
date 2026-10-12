import { mkdir, statfs } from 'node:fs/promises'
import { checkTools, checkWhisperModels } from '@clipstudio/media'

export default defineEventHandler(async () => {
  const { config } = useCore()
  await mkdir(config.dataDir, { recursive: true })
  const [tools, whisperModels, fsStats] = await Promise.all([
    checkTools(),
    checkWhisperModels(config.modelsDir),
    statfs(config.dataDir),
  ])
  return {
    tools,
    whisperModels,
    worker: readWorkerStatus(),
    storage: {
      dataDir: config.dataDir,
      freeBytes: fsStats.bavail * fsStats.bsize,
      totalBytes: fsStats.blocks * fsStats.bsize,
    },
    node: process.version,
  }
})
