import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'

/**
 * Loudness per second (dBFS, RMS) of a 16-bit mono WAV, the audio.wav every project gets for transcription.
 * Reads the file as a stream, so an 8-hour VOD (≈ 900 MB of audio) uses almost no memory.
 */
export async function loudnessCurve(wavPath: string, opts: { signal?: AbortSignal; onProgress?: (f: number) => void } = {}): Promise<number[]> {
  const { dataOffset, dataBytes, sampleRate } = await readWavHeader(wavPath)
  const perSecond = sampleRate
  const out: number[] = []
  let sum = 0
  let count = 0
  let carry: Buffer | null = null
  let read = 0
  const stream = createReadStream(wavPath, { start: dataOffset, end: dataOffset + dataBytes - 1, highWaterMark: 1 << 20 })
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    if (opts.signal?.aborted) {
      stream.destroy()
      throw new Error('Stopped')
    }
    const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk
    const usable: number = buf.length - (buf.length % 2)
    carry = usable < buf.length ? buf.subarray(usable) : null
    for (let i = 0; i < usable; i += 2) {
      const v = buf.readInt16LE(i)
      sum += v * v
      if (++count === perSecond) {
        out.push(toDb(sum / count))
        sum = 0
        count = 0
      }
    }
    read += chunk.length
    opts.onProgress?.(Math.min(1, read / dataBytes))
  }
  if (count > perSecond / 4) out.push(toDb(sum / count))
  return out
}

function toDb(meanSquare: number): number {
  if (meanSquare <= 0) return -90
  return Math.max(-90, Math.round(10 * Math.log10(meanSquare / (32768 * 32768)) * 10) / 10)
}

/** Finds the sample rate and the "data" chunk of a PCM WAV file. */
async function readWavHeader(path: string): Promise<{ dataOffset: number; dataBytes: number; sampleRate: number }> {
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(4096)
    const { bytesRead } = await fh.read(head, 0, head.length, 0)
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file')
    let pos = 12
    let sampleRate = 16_000
    while (pos + 8 <= bytesRead) {
      const id = head.toString('ascii', pos, pos + 4)
      const size = head.readUInt32LE(pos + 4)
      if (id === 'fmt ') {
        const channels = head.readUInt16LE(pos + 10)
        sampleRate = head.readUInt32LE(pos + 12)
        const bits = head.readUInt16LE(pos + 22)
        if (channels !== 1 || bits !== 16) throw new Error(`Expected 16-bit mono audio, got ${channels} channel(s) at ${bits} bits`)
      }
      if (id === 'data') {
        const { size: fileSize } = await fh.stat()
        // ffmpeg writes a placeholder size when streaming; trust the file length then.
        const dataBytes = size === 0 || size === 0xffffffff ? fileSize - (pos + 8) : Math.min(size, fileSize - (pos + 8))
        return { dataOffset: pos + 8, dataBytes, sampleRate }
      }
      pos += 8 + size + (size % 2)
    }
    throw new Error('No audio data in the WAV file')
  } finally {
    await fh.close()
  }
}
