<script setup lang="ts">
import { drawCaptions, OUT_H, OUT_W, paginate, sampleWords, type CaptionStyle, type Page } from '@clipstudio/captions'

/** A looping mini preview of a caption style on sample words. */
const props = defineProps<{ captionStyle: CaptionStyle }>()
const canvas = ref<HTMLCanvasElement>()
const SCALE = 0.16
const LOOP = 2400
/** Only a band around the captions is shown, in output units. */
const BAND = 760
const bandStyle = () => ({ ...props.captionStyle, y: BAND / 2 / OUT_H })
const words = sampleWords(LOOP)
let pages: Page[] = []
let frame = 0

function draw(now: number) {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
  const g = ctx.createLinearGradient(0, 0, 0, BAND)
  g.addColorStop(0, '#3f3f46')
  g.addColorStop(1, '#18181b')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, OUT_W, BAND)
  drawCaptions(ctx, pages, bandStyle(), now % LOOP)
  frame = requestAnimationFrame(draw)
}

function repaginate() {
  const ctx = canvas.value?.getContext('2d')
  if (ctx) pages = paginate(ctx, words, bandStyle())
}

watch(() => props.captionStyle, repaginate, { deep: true })
onMounted(async () => {
  await document.fonts.ready
  repaginate()
  frame = requestAnimationFrame(draw)
})
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <canvas ref="canvas" :width="OUT_W * SCALE" :height="BAND * SCALE" class="w-full rounded-md" />
</template>
