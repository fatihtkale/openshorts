/** Posts between ?from and ?to (epoch ms), for the calendar. */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const from = Number(q.from)
  const to = Number(q.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 62 * 86_400_000) {
    throw createError({ statusCode: 400, statusMessage: 'Give a range of up to two months' })
  }
  return useCore().posts.calendar(from, to)
})
