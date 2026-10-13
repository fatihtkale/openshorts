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
    expect(meta.platform).toBe('youtube')
  })

  it('reads Twitch VODs and clips', () => {
    const vod = parseYoutubeInfo({
      id: 'v2283410123',
      extractor_key: 'TwitchVod',
      title: 'Ranked grind',
      uploader: 'SomeStreamer',
      uploader_id: 'somestreamer',
      duration: 14_400,
      view_count: 812,
      thumbnail: 'https://static-cdn.jtvnw.net/cf_vods/x/thumb.jpg',
      formats: [{ height: 1080 }, { height: 720 }],
    })
    expect(vod).toMatchObject({ videoId: 'v2283410123', platform: 'twitch', channel: 'SomeStreamer', durationSec: 14_400, maxHeight: 1080 })
    expect(vod.twitch).toEqual({ kind: 'vod', channelLogin: 'somestreamer', viewCount: 812 })

    const clip = parseYoutubeInfo({ id: '1234567', display_id: 'BraveTastyOtter-AbC', extractor_key: 'TwitchClips', title: 'No way', duration: 29.5 })
    expect(clip).toMatchObject({ videoId: 'BraveTastyOtter-AbC', platform: 'twitch', twitch: { kind: 'clip' } })
  })

  it('explains Twitch failures', () => {
    expect(friendlyYtdlpError(['ERROR: [twitch:vod] 123: This video is only available to subscribers (sub-only)'])).toMatch(/subscribers only/)
    expect(friendlyYtdlpError(['ERROR: [twitch:vod] 123: HTTP Error 404: Not Found'])).toMatch(/VODs are deleted/)
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

describe('face detector helpers', async () => {
  const { decodeFaces, letterbox, unpad, frameDifference } = await import('./faces')

  it('keeps confident boxes, removes overlaps and sorts by size', () => {
    // Three candidates: two overlapping faces (keep the more confident), one weak box.
    const scores = new Float32Array([0.1, 0.9, 0.2, 0.8, 0.6, 0.4])
    const boxes = new Float32Array([0.1, 0.1, 0.3, 0.4, 0.11, 0.1, 0.31, 0.41, 0.6, 0.6, 0.7, 0.7])
    const faces = decodeFaces(scores, boxes)
    expect(faces).toHaveLength(1)
    expect(faces[0]).toMatchObject({ x: 0.1, y: 0.1, score: 0.9 })
  })

  it('fits wide video without stretching and maps boxes back', () => {
    const fit = letterbox(1920, 800)
    expect(fit).toEqual({ x: 0, y: 53, w: 320, h: 134 })
    // A box in the middle of the padded input is in the middle of the source.
    const [f] = unpad([{ x: 0.45, y: 0.45, w: 0.1, h: 0.1, score: 1 }], { x: 0, y: 60, w: 320, h: 120 })
    expect(f!.y).toBeCloseTo(0.4, 2)
    expect(unpad([{ x: 0.1, y: 0.01, w: 0.1, h: 0.05, score: 1 }], { x: 0, y: 60, w: 320, h: 120 })).toEqual([])
  })

  it('measures frame differences', () => {
    expect(frameDifference(new Uint8Array([0, 10]), new Uint8Array([10, 10]))).toBe(5)
  })
})
