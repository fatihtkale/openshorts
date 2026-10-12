export default defineEventHandler((event) =>
  withProjectErrors(() => useCore().transcripts.dto(getRouterParam(event, 'id')!)),
)
