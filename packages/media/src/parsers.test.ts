import { describe, expect, it } from 'vitest'
import { parseFfmpegProgress } from './ffmpeg'
import { parseProbe } from './ffprobe'
import { thumbnailTime } from './prepare'
import { formatSelector, friendlyYtdlpError, parseYoutubeInfo, parseYtdlpProgress } from './ytdlp'

describe('yt-dlp', () => {
  it('parses our progress lines', () => {
    expect(parseYtdlpProgress('CSPROG 500 1000 NA avc1.4D4020')).toEqual({ downloaded: 500, total: 1000, audioOnly: false })
    expect(parseYtdlpProgress('CSPROG 10 NA 400 none')).toEqual({ downloaded: 10, total: 400, audioOnly: true })
    expect(parseYtdlpProgress('[download] Destination: x.mp4')).toBeNull()
  })

  it('maps known errors to plain sentences', () => {
    expect(friendlyYtdlpError(["ERROR: [youtube] abc: Sign in to confirm you're not a bot"])).toMatch(/bot check/)
    expect(friendlyYtdlpError(['ERROR: [youtube] abc: Private video. Sign in if you have access'])).toBe('This video is private.')
    expect(friendlyYtdlpError(['WARNING: x', 'ERROR: [youtube] abc: Something new'])).toBe('Something new')
  })

  it('prefers H.264 at the chosen height', () => {
    expect(formatSelector('720')).toContain('[height<=720][vcodec^=avc1]')
    expect(formatSelector('best')).toBe('bv*+ba/b')
  })

  it('keeps the useful metadata', () => {
    const meta = parseYoutubeInfo({
      id: 'aqz-KE-bpKQ',
      title: 'Big Buck Bunny',
      channel: 'Blender',
      duration: 635,
      upload_date: '20141110',
      license: 'Creative Commons Attribution license (reuse allowed)',
      live_status: 'not_live',
      formats: [{ height: 360 }, { height: 2160 }, { height: null }],
    })
    expect(meta).toMatchObject({ videoId: 'aqz-KE-bpKQ', durationSec: 635, maxHeight: 2160, isLive: false })
    expect(meta.thumbnailUrl).toBe('https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg')
  })
})

describe('ffprobe', () => {
  const base = {
    format: { duration: '12.5', format_name: 'mov,mp4' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  }

  it('reads length, size, frame rate and audio', () => {
    expect(parseProbe(base)).toMatchObject({ durationMs: 12500, width: 1920, height: 1080, fps: 29.97, hasAudio: true })
  })

  it('swaps width and height for rotated phone video', () => {
    const rotated = {
      ...base,
      streams: [{ ...base.streams[0], side_data_list: [{ rotation: -90 }] }],
    }
    expect(parseProbe(rotated)).toMatchObject({ width: 1080, height: 1920, hasAudio: false })
  })

  it('ignores cover art and rejects files without video', () => {
    expect(() =>
      parseProbe({ format: { duration: '3' }, streams: [{ codec_type: 'video', width: 600, height: 600, disposition: { attached_pic: 1 } }] }),
    ).toThrow(/no video track/)
  })
})

describe('ffmpeg', () => {
  it('reads progress lines', () => {
    expect(parseFfmpegProgress('out_time_us=2500000')).toBe(2.5)
    expect(parseFfmpegProgress('frame=10')).toBeNull()
  })

  it('takes the cover frame early but not from the very start', () => {
    expect(thumbnailTime(10_000)).toBe(2)
    expect(thumbnailTime(3_600_000)).toBe(10)
  })
})
