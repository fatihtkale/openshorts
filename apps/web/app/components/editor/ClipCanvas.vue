<script setup lang="ts">
import {
  CAPTION_FONTS,
  drawCaptions,
  drawHook,
  drawSafeZones,
  fillRect,
  fitRect,
  nextKept,
  OUT_H,
  OUT_W,
  outputToSource,
  paginate,
  panelRect,
  sourceToOutput,
  type Page,
} from '@clipstudio/captions'
import type { ClipEditor } from '~/composables/useClipEditor'

/**
 * The live 9:16 preview. A hidden <video> plays the 720p preview copy; each frame is drawn onto the canvas
 * with the clip's layout, then the captions and hook from the same engine the exporter uses.
 */
const props = defineProps<{ editor: ClipEditor; safeZones: boolean }>()
const time = defineModel<number>('time', { default: 0 })
const playing = defineModel<boolean>('playing', { default: false })

const canvas = ref<HTMLCanvasElement>()
const video = ref<HTMLVideoElement>()
const fontsReady = ref(false)
const SCALE = 0.5

const project = computed(() => props.editor.data.value?.project)
const draft = computed(() => props.editor.draft.value)
const src = computed(() => (project.value?.assets.proxy ? `/api/projects/${project.value.id}/media/proxy?v=${project.value.assets.proxy.updatedAt}` : undefined))

// Captions are split into pages once per change of words or style, not every frame.
const pages = shallowRef<Page[]>([])
watch(
  [() => props.editor.captionWords.value, () => draft.value?.edit.captions.style, fontsReady],
  () => {
    const ctx = canvas.value?.getContext('2d')
    const style = draft.value?.edit.captions.style
    if (!ctx || !style) return
    pages.value = paginate(ctx, props.editor.captionWords.value, style)
  },
  { deep: true, flush: 'post' },
)

function draw() {
  const ctx = canvas.value?.getContext('2d')
  const v = video.value
  const d = draft.value
  if (!ctx || !d) return
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, OUT_W, OUT_H)

  const t = time.value
  const sourceMs = outputToSource(props.editor.segments.value, t)
  if (v && v.readyState >= 2 && v.videoWidth) {
    const vw = v.videoWidth
    const vh = v.videoHeight
    const layout = props.editor.layout.value ?? d.edit.layout
    if (layout.mode === 'fill') {
      const r = fillRect(layout, vw, vh, sourceMs - d.startMs)
      ctx.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, OUT_W, OUT_H)
    } else if (layout.mode === 'split') {
      const top = panelRect(layout.split.top, vw, vh)
      const bottom = panelRect(layout.split.bottom, vw, vh)
      ctx.drawImage(v, top.x, top.y, top.w, top.h, 0, 0, OUT_W, OUT_H / 2)
      ctx.drawImage(v, bottom.x, bottom.y, bottom.w, bottom.h, 0, OUT_H / 2, OUT_W, OUT_H / 2)
    } else {
      // Fit: a blurred, darkened fill behind the whole frame (the exporter does the same with ffmpeg).
      const cover = Math.max(OUT_W / vw, OUT_H / vh)
      ctx.save()
      ctx.filter = 'blur(28px) brightness(0.88) saturate(1.1)'
      ctx.drawImage(v, (OUT_W - vw * cover) / 2, (OUT_H - vh * cover) / 2, vw * cover, vh * cover)
      ctx.restore()
      const r = fitRect(vw, vh)
      ctx.drawImage(v, r.x, r.y, r.w, r.h)
    }
  }
  if (d.edit.captions.enabled) drawCaptions(ctx, pages.value, d.edit.captions.style, t)
  if (d.edit.hook.enabled) drawHook(ctx, d.edit.hook, t)
  if (props.safeZones) drawSafeZones(ctx)
}

// ── Playback ─────────────────────────────────────────────────────────
let frame = 0
function tick() {
  const v = video.value
  if (!v) return
  const segments = props.editor.segments.value
  let ms = v.currentTime * 1000
  const end = segments.at(-1)?.end ?? 0
  if (ms >= end - 15) {
    // Loop back to the start of the clip.
    v.currentTime = (segments[0]?.start ?? 0) / 1000
    ms = segments[0]?.start ?? 0
  } else if (sourceToOutput(segments, ms) === null) {
    // Inside a cut: jump to the next kept part.
    const next = nextKept(segments, ms)
    if (next !== null) {
      v.currentTime = next / 1000
      ms = next
    }
  }
  time.value = sourceToOutput(segments, ms) ?? time.value
  draw()
  frame = requestAnimationFrame(tick)
}

watch(playing, async (on) => {
  const v = video.value
  if (!v) return
  if (on) {
    const segments = props.editor.segments.value
    if (sourceToOutput(segments, v.currentTime * 1000) === null) v.currentTime = outputToSource(segments, time.value) / 1000
    try {
      await v.play()
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tick)
    } catch {
      playing.value = false
    }
  } else {
    v.pause()
    cancelAnimationFrame(frame)
    draw()
  }
})

/** Shows the frame at an output time (when paused, or to jump while playing). */
function seek(outputMs: number) {
  const ms = Math.max(0, Math.min(props.editor.duration.value, outputMs))
  time.value = ms
  if (video.value) video.value.currentTime = outputToSource(props.editor.segments.value, ms) / 1000
  draw()
}

// Redraw when anything visible changes while paused.
watch(
  [() => draft.value, () => props.safeZones, pages],
  () => {
    if (!playing.value) draw()
  },
  { deep: true, flush: 'post' },
)
// A clip boundary or cut changed: keep the playhead inside.
watch(
  () => props.editor.segments.value,
  () => {
    if (time.value > props.editor.duration.value) seek(0)
    else if (!playing.value) seek(time.value)
  },
)

onMounted(async () => {
  await Promise.all(CAPTION_FONTS.flatMap((f) => f.weights.map((w) => document.fonts.load(`${w} 40px "${f.family}"`))))
  fontsReady.value = true
  draw()
})
onBeforeUnmount(() => cancelAnimationFrame(frame))

defineExpose({ seek, video, redraw: draw })
</script>

<template>
  <div class="relative">
    <canvas ref="canvas" :width="OUT_W * SCALE" :height="OUT_H * SCALE" class="block aspect-[9/16] h-full max-h-full w-auto rounded-xl bg-black shadow-lg" @click="playing = !playing" />
    <video
      ref="video"
      :src="src"
      preload="auto"
      playsinline
      class="hidden"
      @loadeddata="seek(time)"
      @seeked="!playing && draw()"
      @pause="playing = false"
    />
  </div>
</template>
