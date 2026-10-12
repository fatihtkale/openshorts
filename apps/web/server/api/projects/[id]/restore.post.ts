export default defineEventHandler((event) =>
  withProjectErrors(() => useCore().projects.restore(getRouterParam(event, 'id')!)),
)
