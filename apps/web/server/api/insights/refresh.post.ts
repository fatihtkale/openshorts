/** "Check views now": queues a view-count check for every live post (the worker reads them from the platforms). */
export default defineEventHandler(() => useCore().posts.requestStatsNow())
