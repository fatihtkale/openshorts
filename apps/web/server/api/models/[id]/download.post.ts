import { WHISPER_MODEL_IDS } from '@clipstudio/core'

/** Queues a model download (the browser asks for confirmation first). */
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  const { models, queue } = useCore()
  return withProjectErrors(() => {
    const model = models.find(id)
    if (models.isInstalled(model)) throw createError({ statusCode: 409, statusMessage: 'Already installed' })
    if (listModelsWithDownloads().find((m) => m.id === id)?.downloadJobId) {
      throw createError({ statusCode: 409, statusMessage: 'Already downloading' })
    }
    queue.enqueue('models.download', { modelId: id as (typeof WHISPER_MODEL_IDS)[number] })
    return listModelsWithDownloads()
  })
})
