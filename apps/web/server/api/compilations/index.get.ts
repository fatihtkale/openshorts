/** Every compilation, newest change first. */
export default defineEventHandler(() => useCore().compilations.list())
