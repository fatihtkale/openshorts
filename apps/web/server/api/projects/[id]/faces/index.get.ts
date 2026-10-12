/** The face track (JSON) used for automatic framing, once analysis has run. */
export default defineEventHandler(async (event) => {
  const asset = useCore().projects.asset(getRouterParam(event, 'id')!, 'faces')
  if (!asset) throw createError({ statusCode: 404, statusMessage: 'Faces not analysed yet' })
  return sendStoredFile(event, asset.storageKey, 'application/json', 'private, no-cache')
})
