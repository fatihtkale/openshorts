import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { effectiveCuts, keptSegments, wordsToOutput } from '@clipstudio/captions'
import { projectPrefix } from '@clipstudio/core'
import { renderClip } from '@clipstudio/media'
import type { HandlerDeps, JobHandler } from './index'

/** Exports a clip as a vertical MP4: cuts, layout, captions and hook, exactly as the editor previews it. */
export function createRenderHandler({ projects, transcripts, clips, renders, storage }: HandlerDeps): JobHandler<'clip.render'> {
  return async ({ renderId }, ctx) => {
    const render = renders.get(renderId)
    if (!render) throw new Error('This export no longer exists.')
    const clip = clips.require(render.clipId)
    const project = projects.require(clip.projectId)
    const source = projects.asset(project.id, 'source')
    if (!source || !project.width || !project.height) throw new Error('The source video is missing.')
    renders.markRunning(renderId)

    const words = transcripts.get(project.id)?.words ?? []
    const range = { start: clip.startMs, end: clip.endMs }
    const segments = keptSegments(range, effectiveCuts(words, range, clip.edit.trim))
    const captionWords = wordsToOutput(words, segments, { keywords: clip.keywords, emojis: clip.edit.emojis })

    const prefix = projectPrefix(project.id)
    const key = `${prefix}/renders/${renderId}.mp4`
    const out = await storage.localWritePath(key)
    ctx.progress(0, 'Starting')
    const result = await renderClip({
      src: await storage.localPath(source.storageKey),
      source: { width: project.width, height: project.height, hasAudio: project.hasAudio !== false },
      segments,
      clipStartMs: clip.startMs,
      layout: clip.edit.layout,
      captions: clip.edit.captions.enabled && captionWords.length ? { style: clip.edit.captions.style, words: captionWords } : null,
      hook: clip.edit.hook.enabled ? clip.edit.hook : null,
      out,
      workDir: dirname(await storage.localWritePath(`${prefix}/renders/tmp-${renderId}/crop.cmd`)),
      signal: ctx.signal,
      onProgress: (f) => ctx.progress(f, 'Rendering'),
    })
    await storage.commitLocalWrite(key)
    await storage.delete(`${prefix}/renders/tmp-${renderId}`)
    renders.complete(renderId, { storageKey: key, bytes: (await stat(out)).size, durationMs: result.durationMs })
    ctx.log(`exported ${result.frames} frames with ${result.encoder}`)
    return { frames: result.frames, encoder: result.encoder }
  }
}
