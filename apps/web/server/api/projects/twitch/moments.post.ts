import { groupMoments, parseTwitchUrl } from '@clipstudio/core'
import { SocialError, twitchVod, twitchVodClips } from '@clipstudio/social'
import { z } from 'zod'

/**
 * Smart import, step 1: the moments of a Twitch VOD that viewers clipped, grouped and padded with context, so only
 * those parts need downloading. Reads Twitch's public data with the app from .env; downloads nothing.
 */
export default defineEventHandler(async (event) => {
  const { url } = await readValidatedBody(event, z.object({ url: z.string().max(2000) }).parse)
  const app = useCore().config.twitch
  if (!app) throw createError({ statusCode: 409, statusMessage: 'Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to .env and restart the app' })
  const parsed = parseTwitchUrl(url)
  if (parsed?.kind !== 'vod') throw createError({ statusCode: 400, statusMessage: 'Not a Twitch VOD link' })
  try {
    const vod = await twitchVod(app, parsed.id)
    if (!vod) throw createError({ statusCode: 404, statusMessage: 'Twitch has no VOD with this id (it may have been deleted)' })
    const clips = await twitchVodClips(app, vod)
    return { vodDurationSec: vod.durationSec, clips: clips.length, moments: groupMoments(clips, vod.durationSec) }
  } catch (error) {
    if (error instanceof SocialError) throw createError({ statusCode: 502, statusMessage: error.message })
    throw error
  }
})
