/** Finds the highlights (again), e.g. after a Twitch app was added to .env. Read-only work, so no confirm needed. */
export default defineEventHandler(async (event) => {
  const core = useCore()
  const id = getRouterParam(event, 'id')!
  await withProjectErrors(() => core.projects.requestHighlights(id))
  return { queued: true }
})
