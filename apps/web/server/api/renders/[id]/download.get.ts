/** The exported MP4, named after the clip. `?inline=1` plays it in the browser instead of downloading. */
export default defineEventHandler(async (event) => {
  const { renders, clips } = useCore()
  const render = renders.get(getRouterParam(event, 'id')!)
  if (!render || render.status !== 'done' || !render.storageKey) throw createError({ statusCode: 404, statusMessage: 'Export not ready' })
  const clip = clips.require(render.clipId)
  const name = `${clip.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'clip'}.mp4`
  if (!getQuery(event).inline) {
    setResponseHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
  }
  return sendStoredFile(event, render.storageKey, 'video/mp4')
})
