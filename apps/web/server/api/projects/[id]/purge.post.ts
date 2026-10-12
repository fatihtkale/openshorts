/** Deletes a project in the Trash for good, including its files. */
export default defineEventHandler(async (event) => {
  await withProjectErrors(() => useCore().projects.purge(getRouterParam(event, 'id')!))
  return { ok: true }
})
