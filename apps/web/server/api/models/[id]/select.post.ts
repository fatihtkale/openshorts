export default defineEventHandler((event) =>
  withProjectErrors(() => {
    const { models } = useCore()
    models.select(getRouterParam(event, 'id')!)
    return listModelsWithDownloads()
  }),
)
