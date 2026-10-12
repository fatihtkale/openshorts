import { whisperModelUrl } from '@clipstudio/core'
import { downloadFile, fetchHuggingFaceMeta } from '@clipstudio/media'
import type { HandlerDeps, JobHandler } from './index'

/** Downloads a whisper model and verifies it against the checksum Hugging Face publishes. */
export function createModelDownloadHandler({ models }: HandlerDeps): JobHandler<'models.download'> {
  return async ({ modelId }, ctx) => {
    const model = models.find(modelId)
    if (models.isInstalled(model)) return { alreadyInstalled: true }
    const url = whisperModelUrl(model)

    ctx.progress(0, 'Connecting to Hugging Face')
    const meta = await fetchHuggingFaceMeta(url, ctx.signal)
    const mb = (n: number) => Math.round(n / 1_048_576)
    await downloadFile({
      url,
      dest: models.path(model),
      expectedBytes: meta.bytes ?? model.bytes,
      sha256: meta.sha256,
      signal: ctx.signal,
      onProgress: (fraction, received) => ctx.progress(fraction, `${mb(received)} of ${mb(model.bytes)} MB`),
    })

    // First model on this Mac: use it.
    if (!models.isInstalled(models.find(models.selectedId()))) models.select(model.id)
    return { verified: !!meta.sha256 }
  }
}
