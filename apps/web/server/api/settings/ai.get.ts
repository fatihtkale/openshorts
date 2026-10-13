import { aiSettings } from '@clipstudio/core'

/** In-app AI settings. Says whether a key is saved, never the key. */
export default defineEventHandler(() => aiSettings(useCore().db))
