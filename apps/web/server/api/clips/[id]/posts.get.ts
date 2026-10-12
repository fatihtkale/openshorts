export default defineEventHandler((event) => useCore().posts.listForClip(getRouterParam(event, 'id')!))
