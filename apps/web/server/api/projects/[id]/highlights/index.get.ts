/** The highlights map: hot spots (best first), a heat strip, and which signals were available. */
export default defineEventHandler(async (event) => {
  const core = useCore()
  const id = getRouterParam(event, 'id')!
  const result = await withProjectErrors(() => core.projects.highlights(id))
  const job = core.queue.activeForProject(id).find((j) => j.type === 'media.highlights')
  return { ...(result ?? { spots: [], strip: [], curve: [], data: null }), running: !!job, twitchApp: !!core.config.twitch }
})
