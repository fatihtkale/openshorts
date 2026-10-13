import { DOWNLOAD_QUALITIES, parseVideoLink } from '@clipstudio/core'
import { z } from 'zod'

const meta = z.object({
  videoId: z.string(),
  title: z.string(),
  channel: z.string().nullable(),
  durationSec: z.number().nullable(),
  uploadDate: z.string().nullable(),
  thumbnailUrl: z.string(),
  license: z.string().nullable(),
  isLive: z.boolean(),
  maxHeight: z.number().nullable(),
  platform: z.enum(['youtube', 'twitch']).optional(),
  twitch: z
    .object({ kind: z.enum(['vod', 'clip']), channelLogin: z.string().nullable(), viewCount: z.number().nullable() })
    .optional(),
})

const body = z.object({
  items: z
    .array(
      z.object({
        url: z.string(),
        name: z.string().max(200).optional(),
        meta,
        quality: z.enum(DOWNLOAD_QUALITIES),
        range: z.object({ start: z.number().min(0), end: z.number().positive() }).optional(),
        /** Twitch clips: score with in-app AI once the transcript is ready (the dialog showed the cost). */
        autoEvaluate: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(20),
})

/** Creates one project per confirmed link (YouTube video, Twitch VOD or clip) and queues its download. */
export default defineEventHandler(async (event) => {
  const { items } = await readValidatedBody(event, body.parse)
  const { projects } = useCore()
  return withProjectErrors(() =>
    items.map((item) => {
      const parsed = parseVideoLink(item.url)
      if (!parsed || parsed.id !== item.meta.videoId || parsed.platform !== (item.meta.platform ?? 'youtube')) {
        throw createError({ statusCode: 400, statusMessage: `Not a YouTube or Twitch link: ${item.url}` })
      }
      const meta = { ...item.meta, autoEvaluate: parsed.kind === 'clip' && item.autoEvaluate === true }
      const row = projects.createFromYoutube({ ...item, meta, url: parsed.url })
      return projects.getDto(row.id)
    }),
  )
})
