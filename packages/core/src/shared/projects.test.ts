import { describe, expect, it } from 'vitest'
import { formatTimecode, nameFromFilename, parseTimecode, parseYoutubeUrl, splitLinks } from './projects'

describe('parseYoutubeUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://youtube.com/watch?v=aqz-KE-bpKQ&t=42s&list=PL123', 'aqz-KE-bpKQ'],
    ['youtube.com/watch?v=aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://m.youtube.com/watch?v=aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://youtu.be/aqz-KE-bpKQ?si=abc', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/shorts/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/live/aqz-KE-bpKQ?feature=share', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/embed/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
  ])('reads %s', (input, id) => {
    expect(parseYoutubeUrl(input)).toEqual({ videoId: id, url: `https://www.youtube.com/watch?v=${id}` })
  })

  it.each([
    'https://vimeo.com/123456',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/watch?v=short',
    'https://evil.com/watch?v=aqz-KE-bpKQ',
    'https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ',
    'not a link',
  ])('rejects %s', (input) => {
    expect(parseYoutubeUrl(input)).toBeNull()
  })
})

describe('splitLinks', () => {
  it('splits on whitespace and commas, dropping duplicates', () => {
    expect(splitLinks(' a\nb, c  a ')).toEqual(['a', 'b', 'c'])
  })
})

describe('timecodes', () => {
  it.each([
    ['45', 45],
    ['1:30', 90],
    ['01:02:03', 3723],
    ['0:00', 0],
    ['1:30.5', 90.5],
  ])('parses %s', (input, seconds) => {
    expect(parseTimecode(input)).toBe(seconds)
  })

  it.each(['', 'abc', '1:60', '1:2:3:4', '-5', '1::2'])('rejects %j', (input) => {
    expect(parseTimecode(input)).toBeNull()
  })

  it('formats seconds', () => {
    expect(formatTimecode(5)).toBe('0:05')
    expect(formatTimecode(65)).toBe('1:05')
    expect(formatTimecode(3725)).toBe('1:02:05')
  })
})

describe('nameFromFilename', () => {
  it('drops the extension and underscores', () => {
    expect(nameFromFilename('My_Podcast_Ep_12.mp4')).toBe('My Podcast Ep 12')
    expect(nameFromFilename('.mp4')).toBe('Untitled video')
  })
})
