export default defineEventHandler((event) => {
  const deleted = getQuery(event).deleted === 'true'
  return useCore().projects.list({ deleted })
})
