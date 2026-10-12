import { DOWNLOAD_QUALITIES, parseYoutubeUrl } from '@clipstudio/core'
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
      }),
    )
    .min(1)
    .max(20),
})

/** Creates one project per confirmed link and queues its download. */
export default defineEventHandler(async (event) => {
  const { items } = await readValidatedBody(event, body.parse)
  const { projects } = useCore()
  return withProjectErrors(() =>
    items.map((item) => {
      const parsed = parseYoutubeUrl(item.url)
      if (!parsed || parsed.videoId !== item.meta.videoId) {
        throw createError({ statusCode: 400, statusMessage: `Not a YouTube link: ${item.url}` })
      }
      const row = projects.createFromYoutube({ ...item, url: parsed.url })
      return projects.getDto(row.id)
    }),
  )
})
