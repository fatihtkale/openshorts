export default defineEventHandler((event) =>
  withProjectErrors(() => useCore().proposals.dismiss(getRouterParam(event, 'id')!)),
)
