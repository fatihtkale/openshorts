/**
 * The app holds account tokens and can delete files, so only this Mac may use it:
 * - the Host header must be one of ours (stops DNS rebinding);
 * - requests that change something must not come from another website's page (stops cross-site requests).
 * Tools like Claude Code send no Origin header, so they pass.
 */
export default defineEventHandler((event) => {
  const path = event.path
  if (!path.startsWith('/api/') && !path.startsWith('/mcp')) return

  const host = getRequestHeader(event, 'host')
  if (host && !allowedHosts().includes(host)) {
    throw createError({ statusCode: 403, statusMessage: 'Unknown host' })
  }

  const method = event.method
  const origin = getRequestHeader(event, 'origin')
  if (origin && method !== 'GET' && method !== 'HEAD') {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      throw createError({ statusCode: 403, statusMessage: 'Bad origin' })
    }
    if (!allowedHosts().includes(originHost)) throw createError({ statusCode: 403, statusMessage: 'Cross-site request refused' })
  }
})
