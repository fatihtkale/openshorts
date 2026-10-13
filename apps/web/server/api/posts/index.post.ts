import { TIKTOK_PRIVACY_LEVELS, YOUTUBE_PRIVACY } from '@clipstudio/core'
import { z } from 'zod'

const body = z.object({
  renderId: z.string(),
  accountId: z.string(),
  title: z.string().max(2200),
  description: z.string().max(5000).optional(),
  youtube: z
    .object({ privacy: z.enum(YOUTUBE_PRIVACY), tags: z.array(z.string().max(100)).max(30), madeForKids: z.boolean(), relatedVideo: z.string().max(300).nullable().optional() })
    .optional(),
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

/** Queues a post. The browser shows a confirmation with every detail before calling this. */
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body.parse)
  return withProjectErrors(() => useCore().posts.create(input))
})
