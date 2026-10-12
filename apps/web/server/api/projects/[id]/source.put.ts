import { UPLOAD_EXTENSIONS } from '@clipstudio/core'

const MIME: Record<(typeof UPLOAD_EXTENSIONS)[number], string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
}

/** Receives an uploaded video as a raw stream (no buffering, so multi-GB files are fine). */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const filename = String(getQuery(event).filename ?? '')
  const { projects, storage } = useCore()
  const key = await withProjectErrors(() => projects.pendingUploadKey(id, filename))
  const expected = Number(getRequestHeader(event, 'content-length'))

  try {
    await storage.put(key, event.node.req)
  } catch {
    projects.markFailed(id, 'The upload was interrupted.')
    throw createError({ statusCode: 400, statusMessage: 'The upload was interrupted' })
  }

  const stat = await storage.stat(key)
  if (!stat || (Number.isFinite(expected) && expected > 0 && stat.size !== expected)) {
    await storage.delete(key)
    projects.markFailed(id, 'The upload did not finish.')
    throw createError({ statusCode: 400, statusMessage: 'The upload did not finish' })
  }

  const ext = key.split('.').pop() as keyof typeof MIME
  projects.sourceReady(id, key, stat.size, MIME[ext] ?? 'application/octet-stream')
  return projects.getDto(id)
})
