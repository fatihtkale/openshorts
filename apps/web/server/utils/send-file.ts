import type { H3Event } from 'h3'

/** Streams a stored file, honouring Range requests so video players can seek. */
export async function sendStoredFile(event: H3Event, key: string, contentType: string) {
  const { storage } = useCore()
  const stat = await storage.stat(key)
  if (!stat) throw createError({ statusCode: 404, statusMessage: 'File not found' })

  setResponseHeaders(event, {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-cache',
    'Last-Modified': stat.modifiedAt.toUTCString(),
  })

  const range = getRequestHeader(event, 'range')
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
  if (match && (match[1] || match[2])) {
    let start = match[1] ? Number(match[1]) : stat.size - Number(match[2])
    let end = match[1] && match[2] ? Number(match[2]) : stat.size - 1
    start = Math.max(0, start)
    end = Math.min(end, stat.size - 1)
    if (start > end) {
      setResponseHeader(event, 'Content-Range', `bytes */${stat.size}`)
      throw createError({ statusCode: 416, statusMessage: 'Range not satisfiable' })
    }
    setResponseStatus(event, 206)
    setResponseHeaders(event, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) })
    return sendStream(event, storage.createReadStream(key, { start, end }))
  }

  setResponseHeader(event, 'Content-Length', stat.size)
  return sendStream(event, storage.createReadStream(key))
}
