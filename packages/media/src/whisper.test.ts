import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { downloadFile } from './download'
import { parseWhisperJson, parseWhisperProgress } from './whisper'

describe('parseWhisperJson', () => {
  const tok = (text: string, p: number) => ({ text, p })

  it('reads one word per segment with confidence and language', () => {
    const out = parseWhisperJson({
      result: { language: 'en' },
      transcription: [
        { text: ' Hello', offsets: { from: 0, to: 320 }, tokens: [tok('[_BEG_]', 0.1), tok(' Hello', 0.9)] },
        { text: ' world.', offsets: { from: 320, to: 800 }, tokens: [tok(' world', 0.8), tok('.', 0.6)] },
      ],
    })
    expect(out).toEqual({
      language: 'en',
      words: [
        { text: 'Hello', start: 0, end: 320, p: 0.9 },
        { text: 'world.', start: 320, end: 800, p: 0.7 },
      ],
    })
  })

  it('drops non-speech markers and glues stray punctuation to the word before', () => {
    const out = parseWhisperJson({
      transcription: [
        { text: ' [BLANK_AUDIO]', offsets: { from: 0, to: 1000 } },
        { text: ' (music)', offsets: { from: 1000, to: 2000 } },
        { text: ' Yes', offsets: { from: 2000, to: 2300 }, tokens: [tok(' Yes', 1)] },
        { text: '!', offsets: { from: 2300, to: 2400 }, tokens: [tok('!', 1)] },
      ],
    })
    expect(out.words).toEqual([{ text: 'Yes!', start: 2000, end: 2400, p: 1 }])
    expect(out.language).toBeNull()
  })

  it('splits a segment that holds several words by character share', () => {
    const out = parseWhisperJson({ transcription: [{ text: ' ab cdef', offsets: { from: 0, to: 600 }, tokens: [] }] })
    expect(out.words.map((w) => [w.text, w.start, w.end])).toEqual([
      ['ab', 0, 200],
      ['cdef', 200, 600],
    ])
  })

  it('reads progress lines', () => {
    expect(parseWhisperProgress('whisper_print_progress_callback: progress =  45%')).toBe(0.45)
    expect(parseWhisperProgress('main: processing audio')).toBeNull()
  })
})

describe('downloadFile', () => {
  const body = Buffer.alloc(200_000, 7)
  const sha256 = createHash('sha256').update(body).digest('hex')
  let server: Server
  let url: string
  let dir: string
  const ranges: (string | undefined)[] = []

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clipstudio-download-'))
    server = createServer((req, res) => {
      if (req.url === '/broken') {
        res.writeHead(500)
        return res.end()
      }
      ranges.push(req.headers.range)
      const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? '')
      if (match && req.url === '/ranged') {
        const start = Number(match[1])
        res.writeHead(206, { 'content-length': body.length - start, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` })
        return res.end(body.subarray(start))
      }
      res.writeHead(200, { 'content-length': body.length })
      res.end(body)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('downloads, verifies the checksum and moves the file into place', async () => {
    const dest = join(dir, 'model.bin')
    const progress: number[] = []
    await downloadFile({ url: `${url}/ok`, dest, expectedBytes: body.length, sha256, onProgress: (f) => f !== null && progress.push(f) })
    expect((await readFile(dest)).equals(body)).toBe(true)
    expect(progress.at(-1)).toBe(1)
  })

  it('rejects a file with the wrong checksum and leaves nothing behind', async () => {
    const dest = join(dir, 'bad.bin')
    await expect(downloadFile({ url: `${url}/ok`, dest, sha256: '0'.repeat(64) })).rejects.toThrow(/checksum/)
    await expect(stat(dest)).rejects.toThrow()
    await expect(stat(`${dest}.partial`)).rejects.toThrow()
  })

  it('continues an interrupted download from its partial file', async () => {
    const dest = join(dir, 'resume.bin')
    await writeFile(`${dest}.partial`, body.subarray(0, 50_000))
    ranges.length = 0
    await downloadFile({ url: `${url}/ranged`, dest, expectedBytes: body.length, sha256 })
    expect(ranges).toEqual(['bytes=50000-'])
    expect((await readFile(dest)).equals(body)).toBe(true)
  })

  it('starts over when the server ignores the range', async () => {
    const dest = join(dir, 'norange.bin')
    await writeFile(`${dest}.partial`, Buffer.alloc(50_000, 1))
    await downloadFile({ url: `${url}/ok`, dest, expectedBytes: body.length, sha256 })
    expect((await readFile(dest)).equals(body)).toBe(true)
  })

  it('reports HTTP errors', async () => {
    await expect(downloadFile({ url: `${url}/broken`, dest: join(dir, 'x.bin') })).rejects.toThrow(/HTTP 500/)
  })
})
