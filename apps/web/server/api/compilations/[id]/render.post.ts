/** Starts an export of the compilation as it is now (the browser confirms first). */
export default defineEventHandler((event) => withProjectErrors(() => useCore().compilations.requestRender(getRouterParam(event, 'id')!)))
