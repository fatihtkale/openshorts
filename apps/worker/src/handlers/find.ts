import { evaluateClips, findClips } from '@clipstudio/ai'
import { grabFrame } from '@clipstudio/media'
import type { HandlerDeps, JobHandler } from './index'

/** Asks the in-app AI for clips; the result is a proposal in the Inbox. Only queued after the user confirmed the run. */
export function createFindClipsHandler(deps: HandlerDeps): JobHandler<'clips.find'> {
  return async (payload, ctx) => {
    ctx.progress(null, 'Reading the transcript')
    const { proposal, skipped } = await findClips(deps, deps.ai(), payload, {
      signal: ctx.signal,
      onProgress: (message) => ctx.progress(null, message),
    })
    for (const s of skipped) ctx.log(`Skipped “${s.title}”: ${s.reason}`)
    return { proposalId: proposal.id, clips: proposal.clips.length, skipped: skipped.length }
  }
}

/** Scores clips with the 4-pillar rubric; the evaluations are notes on the clips. Queued after the user confirmed. */
export function createEvaluateClipsHandler(deps: HandlerDeps): JobHandler<'clips.evaluate'> {
  return async ({ clipIds }, ctx) => {
    const saved = await evaluateClips(deps, deps.ai(), clipIds, {
      signal: ctx.signal,
      onProgress: (message) => ctx.progress(null, message),
      frames: async (projectId, times) => {
        const proxy = deps.projects.asset(projectId, 'proxy')
        if (!proxy) return []
        const src = await deps.storage.localPath(proxy.storageKey)
        const out: { atSec: number; jpeg: Buffer }[] = []
        for (const atSec of times) out.push({ atSec, jpeg: await grabFrame(src, atSec, 384, ctx.signal) })
        return out
      },
    })
    return { evaluated: saved.length, scores: saved.map((c) => c.evaluation?.total ?? null) }
  }
}
