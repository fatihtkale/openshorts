export default defineEventHandler(() => {
  const { proposals, posts } = useCore()
  return { pending: proposals.pendingCount(), missed: posts.missedCount() }
})
