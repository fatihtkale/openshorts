/** Moves the project to the Trash (nothing is deleted from disk yet). */
export default defineEventHandler((event) =>
  withProjectErrors(() => useCore().projects.trash(getRouterParam(event, 'id')!)),
)
