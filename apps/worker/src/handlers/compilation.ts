import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { effectiveCuts, keptSegments, outputDuration } from '@clipstudio/captions'
import { COMPILATION_H, COMPILATION_W, CREDIT_BANNER_MS, creditLine, projectPrefix, type CompilationChapter } from '@clipstudio/core'
import { joinParts, loudnessGain, measureLoudness, renderCompilationPart, type VideoEncoder } from '@clipstudio/media'
import type { HandlerDeps, JobHandler } from './index'

/**
 * Exports a compilation: each clip (with its trims) as a landscape part with its credit banner and even loudness,
 * then all parts joined into one MP4. The file becomes the compilation's project, ready to post.
 */
export function createCompilationHandler({ compilations, clips, projects, transcripts, storage }: HandlerDeps): JobHandler<'compilation.render'> {
  return async ({ compilationId, version }, ctx) => {
    const comp = compilations.require(compilationId)
    if (!comp.items.length) throw new Error('This compilation has no clips.')
    compilations.markRunning(compilationId)

    // The first export makes a project for the result; later ones add to it.
    const projectId = comp.projectId ?? randomUUID()
    const renderId = randomUUID()
    const prefix = projectPrefix(projectId)
    const tmp = `${prefix}/renders/tmp-${renderId}`
    const workDir = await storage.localWritePath(`${tmp}/work`)

    // Work out every part first, so progress can be weighted by length.
    const parts = comp.items.map((item) => {
      const clip = clips.require(item.clipId)
      const project = projects.require(clip.projectId)
      const source = projects.asset(project.id, 'source')
      if (!source || !project.width || !project.height) throw new Error(`The source video of "${clip.title}" is missing.`)
      const range = { start: clip.startMs, end: clip.endMs }
      const words = transcripts.get(project.id)?.words ?? []
      const segments = keptSegments(range, effectiveCuts(words, range, clip.edit.trim))
      return { item, clip, project, source, segments, ms: outputDuration(segments) }
    })
    const totalMs = parts.reduce((n, p) => n + p.ms, 0)

    const files: string[] = []
    const chapters: CompilationChapter[] = []
    let encoder: VideoEncoder = 'h264_videotoolbox'
    let doneMs = 0
    try {
      for (const [i, p] of parts.entries()) {
        const out = join(workDir, `part-${String(i).padStart(3, '0')}.mp4`)
        const src = await storage.localPath(p.source.storageKey)
        const hasAudio = p.project.hasAudio !== false
        ctx.progress((doneMs / totalMs) * 0.97, `Clip ${i + 1} of ${parts.length}: measuring loudness`)
        const gainDb = hasAudio ? loudnessGain(await measureLoudness(src, p.segments, ctx.signal)) : 0
        const options = {
          src,
          gainDb,
          source: { width: p.project.width!, height: p.project.height!, hasAudio },
          segments: p.segments,
          width: COMPILATION_W,
          height: COMPILATION_H,
          banner: { credit: { platform: p.item.credit.platform, name: p.item.credit.name, line: creditLine(p.item.credit) }, durationMs: CREDIT_BANNER_MS },
          out,
          signal: ctx.signal,
          onProgress: (f: number) => ctx.progress(((doneMs + f * p.ms) / totalMs) * 0.97, `Clip ${i + 1} of ${parts.length}`),
        }
        let result
        try {
          result = await renderCompilationPart({ ...options, encoder })
        } catch (error) {
          // The hardware encoder can be busy or missing. Switch for this and every later part (parts must match to join).
          if (ctx.signal.aborted || encoder === 'libx264' || i > 0) throw error
          encoder = 'libx264'
          result = await renderCompilationPart({ ...options, encoder })
        }
        chapters.push({ atMs: Math.round(doneMs), title: p.clip.title, credit: p.item.credit })
        doneMs += result.durationMs
        files.push(out)
      }

      ctx.progress(0.97, 'Joining the clips')
      const key = `${prefix}/renders/${renderId}.mp4`
      const out = await storage.localWritePath(key)
      await joinParts(files, out, workDir, ctx.signal)
      await storage.commitLocalWrite(key)
      compilations.complete(compilationId, {
        projectId,
        renderId,
        storageKey: key,
        bytes: (await stat(out)).size,
        durationMs: Math.round(doneMs),
        chapters,
        version,
        hasAudio: true,
      })
      ctx.log(`compiled ${parts.length} clips (${Math.round(doneMs / 1000)} s) with ${encoder}`)
      return { clips: parts.length, durationMs: Math.round(doneMs), encoder }
    } finally {
      await storage.delete(tmp)
    }
  }
}
