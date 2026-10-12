import { existsSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from '../db/client'
import { ProjectError } from '../errors'
import { getSetting, setSetting } from '../settings'
import { WHISPER_MODELS, type WhisperModel, type WhisperModelStatus } from '../shared/transcripts'

export const SELECTED_MODEL_KEY = 'transcription.model'

/** Whisper model files in the models folder, and which one transcription uses. */
export class ModelService {
  constructor(
    private readonly db: Db,
    private readonly modelsDir: string,
  ) {}

  find(id: string): WhisperModel {
    const model = WHISPER_MODELS.find((m) => m.id === id)
    if (!model) throw new ProjectError(`Unknown model "${id}"`, 'not_found')
    return model
  }

  path(model: WhisperModel): string {
    return join(this.modelsDir, model.file)
  }

  /** Installed means the file is there at its full size (a half-finished download doesn't count). */
  isInstalled(model: WhisperModel): boolean {
    const file = this.path(model)
    return existsSync(file) && statSync(file).size === model.bytes
  }

  selectedId(): string {
    return getSetting<string>(this.db, SELECTED_MODEL_KEY) ?? WHISPER_MODELS.find((m) => m.recommended)!.id
  }

  list(): WhisperModelStatus[] {
    const active = this.active()
    return WHISPER_MODELS.map((m) => ({ ...m, installed: this.isInstalled(m), selected: m.id === active?.id }))
  }

  select(id: string): void {
    const model = this.find(id)
    if (!this.isInstalled(model)) throw new ProjectError('Download this model before using it', 'conflict')
    setSetting(this.db, SELECTED_MODEL_KEY, id)
  }

  /** The model transcription will use: the selected one if installed, otherwise the first installed one. */
  active(): WhisperModel | null {
    const selected = this.find(this.selectedId())
    if (this.isInstalled(selected)) return selected
    return WHISPER_MODELS.find((m) => this.isInstalled(m)) ?? null
  }

  async remove(id: string): Promise<void> {
    const model = this.find(id)
    await rm(this.path(model), { force: true })
    await rm(`${this.path(model)}.partial`, { force: true })
  }
}
