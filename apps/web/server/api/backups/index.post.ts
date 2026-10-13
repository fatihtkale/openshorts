/** Queues a manual database snapshot (the worker makes it). */
export default defineEventHandler(() => {
  const { queue } = useCore()
  if (queue.listRecent(20).some((j) => j.type === 'data.backup' && (j.status === 'queued' || j.status === 'running'))) {
    throw createError({ statusCode: 409, statusMessage: 'A backup is already running' })
  }
  return queue.enqueue('data.backup', {})
})
