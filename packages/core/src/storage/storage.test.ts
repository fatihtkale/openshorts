import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalStorage, normaliseKey } from './index'

let root: string
let storage: LocalStorage

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clipstudio-storage-'))
  storage = new LocalStorage(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('normaliseKey', () => {
  it('accepts plain relative keys', () => {
    expect(normaliseKey('projects/abc/source.mp4')).toBe('projects/abc/source.mp4')
    expect(normaliseKey('projects//abc/./x.txt')).toBe('projects/abc/x.txt')
  })

  it.each(['', '/etc/passwd', '../x', 'a/../../b', 'a\\b', '.'])('rejects %j', (key) => {
    expect(() => normaliseKey(key)).toThrow(/Invalid storage key/)
  })
})

describe('LocalStorage', () => {
  it('writes, reads, stats and lists files', async () => {
    await storage.put('projects/p1/a.txt', 'hello')
    await storage.put('projects/p1/sub/b.txt', Buffer.from('world'))

    expect((await storage.get('projects/p1/a.txt')).toString()).toBe('hello')
    expect(await storage.stat('projects/p1/a.txt')).toMatchObject({ size: 5 })
    expect(await storage.stat('projects/p1/missing.txt')).toBeNull()
    expect(await storage.list('projects/p1')).toEqual(['projects/p1/a.txt', 'projects/p1/sub/b.txt'])
    expect(await storage.list('projects/none')).toEqual([])
  })

  it('writes streams and supports ranged reads', async () => {
    await storage.put('v.bin', Readable.from([Buffer.from('0123456789')]))
    const chunks: Buffer[] = []
    for await (const chunk of storage.createReadStream('v.bin', { start: 2, end: 5 })) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe('2345')
  })

  it('deletes files and folders', async () => {
    await storage.put('projects/p1/a.txt', 'x')
    await storage.delete('projects/p1')
    expect(await storage.list('projects')).toEqual([])
  })

  it('refuses keys that escape the root', async () => {
    await expect(storage.put('../escape.txt', 'x')).rejects.toThrow(/Invalid storage key/)
  })

  it('hands out a local path for tools', async () => {
    expect(await storage.localPath('projects/p1/a.txt')).toBe(join(root, 'projects/p1/a.txt'))
  })
})
