/** Removes a downloaded model file to free disk space. */
export default defineEventHandler(async (event) => {
  const { models } = useCore()
  await withProjectErrors(() => models.remove(getRouterParam(event, 'id')!))
  return listModelsWithDownloads()
})
