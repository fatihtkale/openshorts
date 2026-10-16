/** Deletes the compilation (the browser confirms first). Its finished video stays as a project. */
export default defineEventHandler((event) =>
  withProjectErrors(() => {
    useCore().compilations.remove(getRouterParam(event, 'id')!)
    return { ok: true }
  }),
)
