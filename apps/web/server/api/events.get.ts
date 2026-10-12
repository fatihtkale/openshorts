import { toJobDto } from '@clipstudio/core'

/**
 * Server-sent events: pushes every job change after `?rev=N`.
 * The worker is a separate process, so we watch the jobs table's change counter.
 */
export default defineEventHandler((event) => {
  const { queue } = useCore()
  const requested = Number(getQuery(event).rev)
  let rev = Number.isFinite(requested) ? requested : queue.latestRev()

  const stream = createEventStream(event)

  const poll = setInterval(() => {
    try {
      const rows = queue.changesSince(rev)
      if (rows.length === 0) return
      rev = rows.at(-1)!.rev
      void stream.push({ event: 'jobs', data: JSON.stringify({ rev, jobs: rows.map(toJobDto) }) })
    } catch (error) {
      console.error('[events] poll failed', error)
    }
  }, 400)

  const ping = setInterval(() => void stream.push({ event: 'ping', data: String(Date.now()) }), 15_000)

  stream.onClosed(async () => {
    clearInterval(poll)
    clearInterval(ping)
    await stream.close()
  })

  return stream.send()
})
