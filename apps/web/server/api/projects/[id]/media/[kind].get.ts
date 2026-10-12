import type { AssetKind } from '@clipstudio/core'

const SERVABLE: AssetKind[] = ['proxy', 'thumbnail', 'source']

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const kind = getRouterParam(event, 'kind') as AssetKind
  if (!SERVABLE.includes(kind)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const asset = useCore().projects.asset(id, kind)
  if (!asset) throw createError({ statusCode: 404, statusMessage: 'Not ready yet' })
  return sendStoredFile(event, asset.storageKey, asset.mimeType)
})
