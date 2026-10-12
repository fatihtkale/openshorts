export default defineEventHandler((event) =>
  withProjectErrors(() => useCore().projects.retry(getRouterParam(event, 'id')!)),
)
