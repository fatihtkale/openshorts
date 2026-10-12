import { toPlainText, toSrt } from '@clipstudio/core'

/** Downloads the transcript as subtitles (.srt) or plain text (.txt). */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const format = getQuery(event).format === 'txt' ? 'txt' : 'srt'
  const { transcripts, projects } = useCore()
  const transcript = await withProjectErrors(() => transcripts.dto(id))
  const project = projects.require(id)
  const filename = `${project.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'transcript'}.${format}`
  setResponseHeaders(event, {
    'Content-Type': format === 'srt' ? 'application/x-subrip; charset=utf-8' : 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  })
  return format === 'srt' ? toSrt(transcript.words) : toPlainText(transcript.words)
})
