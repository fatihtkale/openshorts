import { collectPostStats } from '@clipstudio/social'
import type { HandlerDeps, JobHandler } from './index'

/** Reads a post's view count (queued for 48 hours and 7 days after it goes live). */
export function createStatsHandler({ posts, accounts, socialApps }: HandlerDeps): JobHandler<'post.stats'> {
  return async ({ postId }, ctx) => {
    ctx.progress(null, 'Checking views')
    const result = await collectPostStats({ posts, accounts, apps: socialApps }, postId)
    if ('skipped' in result) ctx.log(`Skipped: ${result.skipped}`)
    return result
  }
}
