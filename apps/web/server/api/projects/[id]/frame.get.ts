import { grabFrame } from '@clipstudio/media'

/** A still frame (JPEG) from the preview copy, cached on disk. Used for clip cards. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const q = getQuery(event)
  const ms = Math.max(0, Math.round(Number(q.t) || 0))
  const width = Math.min(960, Math.max(160, Math.round(Number(q.w) || 480)))
  const { projects, storage } = useCore()
  const proxy = projects.asset(id, 'proxy')
  if (!proxy) throw createError({ statusCode: 404, statusMessage: 'Not ready yet' })

  const key = `projects/${id}/frames/${ms}-${width}.jpg`
  if (!(await storage.stat(key))) {
    const jpeg = await grabFrame(await storage.localPath(proxy.storageKey), ms / 1000, width)
    await storage.put(key, jpeg)
  }
  return sendStoredFile(event, key, 'image/jpeg', 'private, max-age=31536000, immutable')
})
