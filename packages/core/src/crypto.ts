import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The key that encrypts account tokens at rest: SECRET_KEY (base64, 32 bytes) from the environment,
 * or a random key created once in the data folder (readable only by this user).
 */
export function loadSecretKey(dataDir: string): Buffer {
  const fromEnv = process.env.SECRET_KEY
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'base64')
    if (key.length !== 32) throw new Error('SECRET_KEY must be 32 bytes, base64-encoded')
    return key
  }
  const file = join(dataDir, 'secret.key')
  if (!existsSync(file)) {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 })
    chmodSync(file, 0o600)
  }
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
}

/** AES-256-GCM: "v1:" + base64(iv ‖ tag ‖ ciphertext). */
export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`
}

export function unseal<T>(key: Buffer, sealed: string): T {
  if (!sealed.startsWith('v1:')) throw new Error('Unknown secret format')
  const raw = Buffer.from(sealed.slice(3), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as T
}
