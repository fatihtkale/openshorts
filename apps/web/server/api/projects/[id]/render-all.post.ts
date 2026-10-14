import { needsExport } from '@clipstudio/core'

/** Exports every approved clip whose latest export is missing, failed or out of date. */
export default defineEventHandler((event) =>
  withProjectErrors(() => {
    const { clips, renders } = useCore()
    const id = getRouterParam(event, 'id')!
    const started = clips
      .list(id, ['approved'])
      .filter(needsExport)
      .map((c) => renders.request(c.id))
    return { started: started.length }
  }),
)
