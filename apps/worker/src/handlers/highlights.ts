import { projectPrefix, type HighlightClip, type HighlightsData } from '@clipstudio/core'
import { loudnessCurve } from '@clipstudio/media'
import { twitchVod, twitchVodClips } from '@clipstudio/social'
import type { HandlerDeps, JobHandler } from './index'

/**
 * Where a long video gets interesting: loudness jumps from its audio, plus (for Twitch VODs, when a Twitch app is set
 * up) the moments viewers clipped. Only reads: nothing is cut or proposed. Stored as highlights.json.
 */
export function createHighlightsHandler({ projects, storage, twitchApp }: HandlerDeps): JobHandler<'media.highlights'> {
  return async ({ projectId }, ctx) => {
    const project = projects.require(projectId)
    const audio = projects.asset(projectId, 'audio')
    const durationSec = (project.durationMs ?? 0) / 1000

    ctx.progress(0, 'Listening for loud moments')
    const loudness = audio ? await loudnessCurve(await storage.localPath(audio.storageKey), { signal: ctx.signal, onProgress: (f) => ctx.progress(f * 0.8) }) : []

    let viewerClips: HighlightClip[] = []
    let viewerClipsStatus: HighlightsData['viewerClipsStatus'] = 'not-twitch'
    let viewerClipsError: string | undefined
    const meta = project.sourceMeta
    if (meta?.twitch?.kind === 'vod') {
      if (!twitchApp) viewerClipsStatus = 'no-keys'
      else {
        ctx.progress(0.85, 'Asking Twitch what viewers clipped')
        try {
          const vod = await twitchVod(twitchApp, meta.videoId)
          const offset = meta.importRange?.start ?? 0
          const clips = vod ? await twitchVodClips(twitchApp, vod) : []
          viewerClips = clips
            .filter((c) => c.vodOffsetSec !== null)
            .map((c) => ({ title: c.title, url: c.url, views: c.viewCount, startSec: c.vodOffsetSec! - offset, durationSec: c.durationSec }))
            .filter((c) => c.startSec + c.durationSec > 0 && c.startSec < durationSec)
          viewerClipsStatus = viewerClips.length ? 'ok' : 'none'
        } catch (error) {
          viewerClipsStatus = 'error'
          viewerClipsError = (error as Error).message
          ctx.log(`Viewer clips unavailable: ${viewerClipsError}`)
        }
      }
    }

    const data: HighlightsData = { version: 1, loudness, viewerClips, viewerClipsStatus, viewerClipsError, computedAt: Date.now() }
    const key = `${projectPrefix(projectId)}/highlights.json`
    const json = JSON.stringify(data)
    await storage.put(key, json)
    projects.setAsset(projectId, 'highlights', key, Buffer.byteLength(json), 'application/json')
    return { seconds: loudness.length, viewerClips: viewerClips.length, viewerClipsStatus }
  }
}
