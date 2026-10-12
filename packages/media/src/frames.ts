import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { findExecutable } from './tools'

const execFileAsync = promisify(execFile)

/**
 * One frame as a JPEG, `width` pixels wide. Fast enough (~0.1 s on the 720p preview) to run inside a request,
 * which is why it's allowed outside the job queue.
 */
export async function grabFrame(src: string, timeSec: number, width = 512, signal?: AbortSignal): Promise<Buffer> {
  const ffmpeg = (await findExecutable('ffmpeg')) ?? 'ffmpeg'
  const { stdout } = await execFileAsync(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error',
      '-ss', Math.max(0, timeSec).toFixed(3),
      '-i', src,
      '-frames:v', '1',
      '-vf', `scale=${Math.round(width)}:-2`,
      '-q:v', '4',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-',
    ],
    { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 15_000, signal },
  )
  if (!stdout.length) throw new Error(`No frame at ${timeSec.toFixed(1)} s`)
  return stdout
}
