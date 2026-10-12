import { SPREAD_MODES, TIKTOK_PRIVACY_LEVELS, YOUTUBE_PRIVACY } from '@clipstudio/core'
import { z } from 'zod'

const item = z.object({
  renderId: z.string(),
  accountId: z.string(),
  title: z.string().max(2200),
  description: z.string().max(5000).optional(),
  scheduledAt: z.number(),
  youtube: z.object({ privacy: z.enum(YOUTUBE_PRIVACY), tags: z.array(z.string().max(100)).max(30), madeForKids: z.boolean() }).optional(),
  tiktok: z
    .object({
      mode: z.enum(['direct', 'draft']),
      privacy: z.enum(TIKTOK_PRIVACY_LEVELS).nullable(),
      allowComments: z.boolean(),
      allowDuet: z.boolean(),
      allowStitch: z.boolean(),
      brandContent: z.boolean(),
      brandOrganic: z.boolean(),
      aiGenerated: z.boolean(),
    })
    .optional(),
})

const body = z.object({
  batch: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timeZone: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    mode: z.enum(SPREAD_MODES),
    jitterMin: z.number().int().min(0).max(60),
  }),
  items: z.array(item).min(1).max(50),
  /** The Inbox proposal this schedule came from, if any. */
  proposalId: z.string().optional(),
})

/** The final step of the scheduler: the user confirmed the day's timeline. */
export default defineEventHandler(async (event) => {
  const { batch, items, proposalId } = await readValidatedBody(event, body.parse)
  const { posts, proposals } = useCore()
  return withProjectErrors(() => {
    const created = posts.createBatch(batch, items)
    if (proposalId) {
      try {
        proposals.completeSchedule(proposalId)
      } catch {
        // The proposal was dismissed meanwhile; the schedule stands.
      }
    }
    return created
  })
})
