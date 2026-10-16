export interface OAuthApp {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  /** Epoch ms. */
  expiresAt: number
  refreshExpiresAt: number | null
  scopes: string[]
}

export interface Profile {
  externalId: string
  displayName: string
  username: string | null
  avatarUrl: string | null
}

export interface UploadFile {
  path: string
  bytes: number
  mimeType: string
  /** A long landscape video (a compilation), not a Short: its link is a normal watch link. */
  longForm?: boolean
}
