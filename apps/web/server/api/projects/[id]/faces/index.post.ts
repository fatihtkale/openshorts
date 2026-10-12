/** Runs (or re-runs) face analysis for a project. */
export default defineEventHandler((event) =>
  withProjectErrors(() => {
    useCore().projects.requestFaces(getRouterParam(event, 'id')!)
    return { ok: true }
  }),
)
