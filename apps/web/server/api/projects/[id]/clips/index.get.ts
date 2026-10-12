import type { ClipStatus } from '@clipstudio/core'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  const status = getQuery(event).status
  const statuses = typeof status === 'string' ? (status.split(',') as ClipStatus[]) : undefined
  return withProjectErrors(() => {
    useCore().projects.require(id)
    return useCore().clips.list(id, statuses)
  })
})
