/** Live posts with their view-count readings; the page works out the best hours itself (same code as the tests). */
export default defineEventHandler(() => ({ posts: useCore().posts.insights() }))
