/** What went wrong talking to a platform, in a form the app can act on. */
export type SocialErrorKind = 'auth' | 'quota' | 'rate' | 'invalid' | 'forbidden' | 'server' | 'network'

export class SocialError extends Error {
  constructor(
    message: string,
    readonly kind: SocialErrorKind,
    /** Worth retrying later (server hiccup, rate limit). */
    readonly retryable = kind === 'server' || kind === 'rate' || kind === 'network',
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'SocialError'
  }
}
