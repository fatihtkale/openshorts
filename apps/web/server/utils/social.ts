import { PLATFORMS, type Platform } from '@clipstudio/core'
import { socialApps } from '@clipstudio/social'

export function apps() {
  return socialApps(useCore().config)
}

export function requirePlatform(value: string | undefined): Platform {
  if (!value || !(PLATFORMS as readonly string[]).includes(value)) throw createError({ statusCode: 404, statusMessage: 'Unknown platform' })
  return value as Platform
}

/** Pending sign-ins, by OAuth state. Kept in settings so a dev-server reload mid-sign-in doesn't lose them. */
export const OAUTH_STATE_PREFIX = 'oauth.state.'
export const OAUTH_STATE_TTL_MS = 10 * 60_000
