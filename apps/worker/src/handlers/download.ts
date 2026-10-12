import { dirname } from 'node:path'
import { projectPrefix } from '@clipstudio/core'
import { downloadYoutube } from '@clipstudio/media'
import type { HandlerDeps, JobHandler } from './index'

export function createDownloadHandler({ projects, storage }: HandlerDeps): JobHandler<'ingest.download'> {
  return async ({ projectId, url, quality, range }, ctx) => {
    const key = `${projectPrefix(projectId)}/source.mp4`
    const outDir = dirname(await storage.localWritePath(key))

    const result = await downloadYoutube({
      url,
      outDir,
      quality,
      range,
      signal: ctx.signal,
      onProgress: (fraction, message) => ctx.progress(fraction, message),
    })

    const actualKey = `${projectPrefix(projectId)}/${result.path.split('/').pop()}`
    await storage.commitLocalWrite(actualKey)
    projects.sourceReady(projectId, actualKey, result.bytes, 'video/mp4')
    return { bytes: result.bytes }
  }
}
