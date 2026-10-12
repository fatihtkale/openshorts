import { createHash, randomBytes } from 'node:crypto'

/** A PKCE code verifier: 64 unreserved characters. */
export function codeVerifier(): string {
  return randomBytes(48).toString('base64url').slice(0, 64)
}

/** RFC 7636 S256 challenge (base64url), as Google expects. */
export function challengeBase64Url(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** TikTok's desktop flow wants the SHA-256 as hex instead. */
export function challengeHex(verifier: string): string {
  return createHash('sha256').update(verifier).digest('hex')
}

export function randomState(): string {
  return randomBytes(24).toString('base64url')
}
