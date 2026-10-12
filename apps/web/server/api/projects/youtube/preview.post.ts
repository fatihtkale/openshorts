import { parseYoutubeUrl, type YoutubePreview } from '@clipstudio/core'
import { fetchYoutubeInfo } from '@clipstudio/media'
import { z } from 'zod'

const body = z.object({ links: z.array(z.string().max(2000)).min(1).max(20) })

/** Looks up title, length and thumbnail for pasted links, so they can be checked before anything downloads. */
export default defineEventHandler(async (event) => {
  const { links } = await readValidatedBody(event, body.parse)
  const { projects } = useCore()

  // Three lookups at a time: each one is a yt-dlp process that takes a few seconds.
  const results: YoutubePreview[] = new Array(links.length)
  let next = 0
  async function worker() {
    while (next < links.length) {
      const i = next++
      const input = links[i]!
      const parsed = parseYoutubeUrl(input)
      if (!parsed) {
        results[i] = { input, url: null, meta: null, error: "This isn't a YouTube video link.", existing: [] }
        continue
      }
      try {
        const meta = await fetchYoutubeInfo(parsed.url, AbortSignal.timeout(45_000))
        results[i] = {
          input,
          url: parsed.url,
          meta,
          error: meta.isLive ? 'This is a live stream or upcoming premiere. Import it after it has ended.' : null,
          existing: projects.findByYoutubeId(meta.videoId),
        }
      } catch (error) {
        const message = (error as Error).name === 'AbortError' ? 'YouTube took too long to answer. Try again.' : (error as Error).message
        results[i] = { input, url: parsed.url, meta: null, error: message, existing: [] }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, links.length) }, worker))
  return results
})
