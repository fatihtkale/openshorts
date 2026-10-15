import { projectPrefix } from '@clipstudio/core'
import { alignToAudio, transcribe } from '@clipstudio/media'
import type { HandlerDeps, JobHandler } from './index'

/** Runs whisper.cpp on the project's 16 kHz audio and stores the words with their timings. */
export function createTranscribeHandler(deps: HandlerDeps): JobHandler<'transcribe'> {
  const { storage, transcripts, models } = deps
  return async ({ projectId, language }, ctx) => {
    const model = models.active()
    if (!model) throw new Error('No speech model is installed. Download one on the System check page.')
    const audio = await storage.localPath(`${projectPrefix(projectId)}/audio.wav`)
    const outBase = await storage.localWritePath(`${projectPrefix(projectId)}/whisper-output`)

    ctx.progress(0, `Loading ${model.label}`)
    const result = await transcribe({
      audioPath: audio,
      modelPath: models.path(model),
      language,
      outBase,
      signal: ctx.signal,
      onProgress: (f) => ctx.progress(f * 0.95, 'Listening'),
    })
    if (result.words.length === 0) throw new Error('No speech was found in this video.')

    // Whisper glues each word's start to the word before, so words after a pause start early; line them up.
    ctx.progress(0.95, 'Lining up words with the audio')
    const aligned = await alignToAudio(audio, result.words, { signal: ctx.signal, onProgress: (f) => ctx.progress(0.95 + f * 0.04) })
    transcripts.complete(projectId, { engine: 'whisper.cpp', model: model.id, language: result.language, words: aligned.words })
    autoEvaluate(deps, projectId, ctx.log)
    return { words: result.words.length, language: result.language, moved: aligned.moved }
  }
}

/**
 * Twitch clips imported with "Score with in-app AI when ready" (a choice made, with its cost, in the import dialog)
 * get evaluated once their transcript exists. Skipped quietly when in-app AI has been turned off since.
 */
export function autoEvaluate({ projects, clips, queue, ai }: HandlerDeps, projectId: string, log: (m: string) => void): void {
  const project = projects.get(projectId)
  if (!project?.sourceMeta?.autoEvaluate) return
  const settings = ai()
  if (settings.provider === 'off' || (settings.provider === 'anthropic' && !settings.anthropicKey)) {
    log('Not scoring: in-app AI is off')
    return
  }
  const ids = clips.list(projectId, ['approved']).filter((c) => !c.evaluation).map((c) => c.id)
  if (ids.length) queue.enqueue('clips.evaluate', { projectId, clipIds: ids }, { projectId })
}

/** Lines up an existing transcript's words with the audio (transcripts made before that step existed). */
export function createRetimeHandler({ storage, transcripts }: HandlerDeps): JobHandler<'transcript.retime'> {
  return async ({ projectId }, ctx) => {
    const row = transcripts.get(projectId)
    if (!row || row.status !== 'ready') return { skipped: 'no finished transcript' }
    const audio = await storage.localPath(`${projectPrefix(projectId)}/audio.wav`)
    ctx.progress(0, 'Lining up words with the audio')
    const aligned = await alignToAudio(audio, row.words, { signal: ctx.signal, onProgress: (f) => ctx.progress(f * 0.95) })
    transcripts.retime(projectId, aligned.words)
    return { words: row.words.length, moved: aligned.moved }
  }
}
