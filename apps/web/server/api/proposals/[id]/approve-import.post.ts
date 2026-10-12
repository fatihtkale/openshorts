/** The user confirmed an import Claude proposed: start the download. */
export default defineEventHandler((event) =>
  withProjectErrors(() => useCore().proposals.approveImport(getRouterParam(event, 'id')!)),
)
