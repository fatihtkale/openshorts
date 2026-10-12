export default defineEventHandler((event) =>
  withProjectErrors(() => useCore().projects.getDto(getRouterParam(event, 'id')!)),
)
