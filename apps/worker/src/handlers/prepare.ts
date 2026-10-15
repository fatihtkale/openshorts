import { projectPrefix } from '@clipstudio/core'
import { makeProxyAndAudio, makeThumbnail, probe } from '@clipstudio/media'
import { stat } from 'node:fs/promises'
import type { HandlerDeps, JobHandler } from './index'

/**
 * Reads the source's length, size and frame rate, grabs a cover image,
 * and writes a 720p preview plus 16 kHz audio for transcription.
 */
export function createPrepareHandler(deps: HandlerDeps): JobHandler<'media.prepare'> {
  const { projects, storage, transcripts, models, clips } = deps
  return async ({ projectId }, ctx) => {
    const source = projects.asset(projectId, 'source')
    if (!source) throw new Error('The source video is missing.')
    const src = await storage.localPath(source.storageKey)
    const prefix = projectPrefix(projectId)

    ctx.progress(0, 'Reading video')
    const info = await probe(src, ctx.signal)

    ctx.progress(0.02, 'Making a cover image')
    const thumbKey = `${prefix}/thumbnail.jpg`
    const thumbPath = await storage.localWritePath(thumbKey)
    await makeThumbnail(src, thumbPath, info, ctx.signal)
    await storage.commitLocalWrite(thumbKey)
    projects.setAsset(projectId, 'thumbnail', thumbKey, (await stat(thumbPath)).size, 'image/jpeg')

    const proxyKey = `${prefix}/proxy.mp4`
    const audioKey = `${prefix}/audio.wav`
    const proxyPath = await storage.localWritePath(proxyKey)
    const audioPath = info.hasAudio ? await storage.localWritePath(audioKey) : null

    ctx.progress(0.05, 'Making a preview copy')
    const encoder = await makeProxyAndAudio({
      src,
      proxyOut: proxyPath,
      audioOut: audioPath,
      info,
      signal: ctx.signal,
      onProgress: (f) => ctx.progress(0.05 + f * 0.95, 'Making a preview copy'),
    })

    await storage.commitLocalWrite(proxyKey)
    projects.setAsset(projectId, 'proxy', proxyKey, (await stat(proxyPath)).size, 'video/mp4')
    if (audioPath) {
      await storage.commitLocalWrite(audioKey)
      projects.setAsset(projectId, 'audio', audioKey, (await stat(audioPath)).size, 'audio/wav')
    }

    projects.markReady(projectId, {
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
      fps: info.fps,
      hasAudio: info.hasAudio,
    })
    ctx.log(`ready (${info.width}x${info.height} @ ${info.fps} fps, encoder ${encoder})`)

    // A Twitch clip is a clip already: the whole video becomes one (the user chose it by importing it).
    const project = projects.require(projectId)
    if (project.sourceMeta?.twitch?.kind === 'clip') clips.createImported(projectId, project.name)

    // Long videos and Twitch VODs get a highlights map (loud moments, what viewers clipped).
    if (info.hasAudio && (project.sourceMeta?.twitch?.kind === 'vod' || info.durationMs >= 10 * 60_000)) {
      deps.queue.enqueue('media.highlights', { projectId }, { projectId })
    }

    // Transcription starts on its own. Face analysis (automatic framing) doesn't: it's slow and most game footage has
    // no faces, so it runs when asked (Find faces in the editor's Layout tab).
    if (info.hasAudio && models.active() && !transcripts.get(projectId)) transcripts.request(projectId, 'auto')
    return { encoder }
  }
}
