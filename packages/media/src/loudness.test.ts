import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loudnessCurve } from './loudness'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clipstudio-loud-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A 16 kHz mono WAV: one second per amplitude (a square wave, so RMS = amplitude). */
function wav(amplitudes: number[]): Buffer {
  const rate = 16_000
  const data = Buffer.alloc(amplitudes.length * rate * 2)
  amplitudes.forEach((a, s) => {
    for (let i = 0; i < rate; i++) data.writeInt16LE(i % 2 ? a : -a, (s * rate + i) * 2)
  })
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

describe('loudnessCurve', () => {
  it('measures each second in dBFS', async () => {
    const path = join(dir, 'a.wav')
    await writeFile(path, wav([32767, 3277, 0]))
    const curve = await loudnessCurve(path)
    expect(curve).toHaveLength(3)
    expect(curve[0]).toBeCloseTo(0, 0)
    expect(curve[1]).toBeCloseTo(-20, 0)
    expect(curve[2]).toBe(-90)
  })
})
