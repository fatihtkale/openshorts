import { unseal, seal } from './crypto'
import type { Db } from './db/client'
import { getSetting, setSetting } from './settings'
import { DEFAULT_AI, type AiProvider, type AiSettingsDto } from './shared/ai'

/** In-app AI settings. The Anthropic key is stored sealed (AES-256-GCM) and only unsealed by the worker. */
export const AI_SETTINGS_KEY = 'ai.settings'

interface StoredAiSettings {
  provider: AiProvider
  anthropicModel: string
  anthropicKey: string | null
  ollamaUrl: string
  ollamaModel: string
}

function stored(db: Db): StoredAiSettings {
  return { ...DEFAULT_AI, anthropicKey: null, ...getSetting<Partial<StoredAiSettings>>(db, AI_SETTINGS_KEY) }
}

export function aiSettings(db: Db): AiSettingsDto {
  const s = stored(db)
  return {
    provider: s.provider,
    anthropicModel: s.anthropicModel,
    hasAnthropicKey: !!s.anthropicKey,
    envKey: !!process.env.ANTHROPIC_API_KEY,
    ollamaUrl: s.ollamaUrl,
    ollamaModel: s.ollamaModel,
  }
}

/**
 * Saves the settings. `anthropicKey`: a string replaces the saved key, null removes it, undefined keeps it.
 */
export function saveAiSettings(
  db: Db,
  key: Buffer,
  input: { provider: AiProvider; anthropicModel: string; ollamaUrl: string; ollamaModel: string; anthropicKey?: string | null },
): AiSettingsDto {
  const current = stored(db)
  const anthropicKey = input.anthropicKey === undefined ? current.anthropicKey : input.anthropicKey ? seal(key, input.anthropicKey.trim()) : null
  setSetting(db, AI_SETTINGS_KEY, {
    provider: input.provider,
    anthropicModel: input.anthropicModel,
    ollamaUrl: input.ollamaUrl.replace(/\/+$/, ''),
    ollamaModel: input.ollamaModel.trim(),
    anthropicKey,
  } satisfies StoredAiSettings)
  return aiSettings(db)
}

/** The settings with the key unsealed, for the code that calls the model. Falls back to ANTHROPIC_API_KEY. */
export function aiCredentials(db: Db, key: Buffer): AiSettingsDto & { anthropicKey: string | null } {
  const s = stored(db)
  return { ...aiSettings(db), anthropicKey: s.anthropicKey ? unseal<string>(key, s.anthropicKey) : (process.env.ANTHROPIC_API_KEY ?? null) }
}
