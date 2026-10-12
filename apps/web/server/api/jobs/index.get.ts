import { toJobDto } from '@clipstudio/core'

export default defineEventHandler(() => {
  const { queue } = useCore()
  // Read the cursor first: anything written after it arrives over /api/events.
  const rev = queue.latestRev()
  return { rev, jobs: queue.listRecent(50).map(toJobDto) }
})
