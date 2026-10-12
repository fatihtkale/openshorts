/** Starts an export of the clip as it is now (the browser confirms first). */
export default defineEventHandler((event) => withProjectErrors(() => useCore().renders.request(getRouterParam(event, 'id')!)))
