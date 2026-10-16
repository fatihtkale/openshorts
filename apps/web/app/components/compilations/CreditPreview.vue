<script setup lang="ts">
import { drawCredit } from '@clipstudio/captions'
import { creditLine, CREDIT_BANNER_MS, type Credit } from '@clipstudio/core/shared'

/**
 * The credit banner as the export draws it (same engine), over the clip's first frame, in a 16:9 box.
 */
const props = defineProps<{ credit: Credit; frameUrl: string | null }>()
const canvas = ref<HTMLCanvasElement>()
const W = 1920
const H = 1080
let image: HTMLImageElement | null = null

async function draw() {
  const c = canvas.value
  const ctx = c?.getContext('2d')
  if (!c || !ctx) return
  await document.fonts.ready
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, W, H)
  if (image?.complete && image.naturalWidth) {
    const s = Math.min(W / image.naturalWidth, H / image.naturalHeight)
    const w = image.naturalWidth * s
    const h = image.naturalHeight * s
    ctx.drawImage(image, (W - w) / 2, (H - h) / 2, w, h)
  }
  // Mid-banner (fully in).
  drawCredit(ctx, { platform: props.credit.platform, name: props.credit.name, line: creditLine(props.credit) }, CREDIT_BANNER_MS / 2, CREDIT_BANNER_MS, W, H)
}

watch(
  () => props.frameUrl,
  (url) => {
    image = null
    if (url) {
      image = new Image()
      image.onload = () => void draw()
      image.src = url
    }
    void draw()
  },
  { immediate: true },
)
watch(() => props.credit, () => void draw(), { deep: true })
onMounted(() => void draw())
</script>

<template>
  <canvas ref="canvas" :width="W" :height="H" class="aspect-video w-full rounded-lg border border-default bg-black" />
</template>
