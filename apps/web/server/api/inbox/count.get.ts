export default defineEventHandler(() => ({ pending: useCore().proposals.pendingCount() }))
