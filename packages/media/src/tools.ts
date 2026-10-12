import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ToolStatus {
  id: string
  name: string
  purpose: string
  /** The build phase that first needs this tool, so the UI can say "not needed yet". */
  neededFrom: number
  found: boolean
  path: string | null
  version: string | null
  installHint: string
}

interface ToolSpec {
  id: string
  name: string
  bin: string
  purpose: string
  neededFrom: number
  installHint: string
  versionArgs: string[]
  parseVersion: (output: string) => string | null
}

const TOOLS: ToolSpec[] = [
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    bin: 'ffmpeg',
    purpose: 'Cuts, crops and encodes video',
    neededFrom: 1,
    installHint: 'brew install ffmpeg',
    versionArgs: ['-version'],
    parseVersion: (out) => /ffmpeg version (\S+)/.exec(out)?.[1] ?? null,
  },
  {
    id: 'ffprobe',
    name: 'FFprobe',
    bin: 'ffprobe',
    purpose: 'Reads video length, size and frame rate',
    neededFrom: 1,
    installHint: 'brew install ffmpeg',
    versionArgs: ['-version'],
    parseVersion: (out) => /ffprobe version (\S+)/.exec(out)?.[1] ?? null,
  },
  {
    id: 'yt-dlp',
    name: 'yt-dlp',
    bin: 'yt-dlp',
    purpose: 'Downloads videos from YouTube links',
    neededFrom: 1,
    installHint: 'brew install yt-dlp',
    versionArgs: ['--version'],
    parseVersion: (out) => out.trim().split('\n')[0] || null,
  },
  {
    id: 'whisper',
    name: 'whisper.cpp',
    bin: 'whisper-cli',
    purpose: 'Transcribes speech locally, with word timings',
    neededFrom: 2,
    installHint: 'brew install whisper-cpp',
    versionArgs: ['--version'],
    parseVersion: (out) => /version:?\s*(\S+)/.exec(out)?.[1] ?? null,
  },
]

/** Homebrew paths are added because apps started from a GUI often get a minimal PATH. */
function searchPath(): string[] {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const extra of ['/opt/homebrew/bin', '/usr/local/bin']) if (!dirs.includes(extra)) dirs.push(extra)
  return dirs
}

export async function findExecutable(bin: string): Promise<string | null> {
  for (const dir of searchPath()) {
    const candidate = join(dir, bin)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // not in this directory
    }
  }
  return null
}

async function checkTool(spec: ToolSpec): Promise<ToolStatus> {
  const base = {
    id: spec.id,
    name: spec.name,
    purpose: spec.purpose,
    neededFrom: spec.neededFrom,
    installHint: spec.installHint,
  }
  const path = await findExecutable(spec.bin)
  if (!path) return { ...base, found: false, path: null, version: null }
  try {
    // Generous timeout: macOS scans a freshly installed binary on its first run.
    const { stdout, stderr } = await execFileAsync(path, spec.versionArgs, { timeout: 20_000 })
    return { ...base, found: true, path, version: spec.parseVersion(stdout || stderr) }
  } catch (error) {
    // Some tools print help to stderr and exit non-zero; being executable is enough.
    const out = (error as { stdout?: string; stderr?: string })
    return { ...base, found: true, path, version: spec.parseVersion(out.stdout || out.stderr || '') }
  }
}

export function checkTools(): Promise<ToolStatus[]> {
  return Promise.all(TOOLS.map(checkTool))
}

export interface ModelStatus {
  found: boolean
  files: string[]
  dir: string
}

/** whisper.cpp models are `ggml-*.bin` files in the models directory. */
export async function checkWhisperModels(modelsDir: string): Promise<ModelStatus> {
  try {
    const files = (await readdir(modelsDir)).filter((f) => /^ggml-.+\.bin$/.test(f)).sort()
    return { found: files.length > 0, files, dir: modelsDir }
  } catch {
    return { found: false, files: [], dir: modelsDir }
  }
}
