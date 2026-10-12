import type { ModelListItem } from '@clipstudio/core'

/** The model list with any download in progress, so the page can follow it live. */
export function listModelsWithDownloads(): ModelListItem[] {
  const { models, queue } = useCore()
  const active = queue
    .listRecent(200)
    .filter((j) => j.type === 'models.download' && (j.status === 'queued' || j.status === 'running'))
  return models.list().map((m) => ({
    ...m,
    downloadJobId: active.find((j) => (j.payload as { modelId?: string }).modelId === m.id)?.id ?? null,
  }))
}
