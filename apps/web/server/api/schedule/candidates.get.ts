/** Clips that can be scheduled: approved, with a finished export. */
export default defineEventHandler(() => useCore().clips.exported())
