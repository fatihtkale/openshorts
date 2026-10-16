/** A compilation with what each of its clips is. */
export default defineEventHandler((event) => withProjectErrors(() => useCore().compilations.detail(getRouterParam(event, 'id')!)))
