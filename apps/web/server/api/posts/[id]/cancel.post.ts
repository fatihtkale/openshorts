export default defineEventHandler((event) => withProjectErrors(() => useCore().posts.cancel(getRouterParam(event, 'id')!)))
