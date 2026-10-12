<script setup lang="ts">
import { drawHook, HOOK_STYLES, OUT_H, OUT_W, type HookSettings, type HookStyleId } from '@clipstudio/captions'
import type { ClipEditor } from '~/composables/useClipEditor'

const props = defineProps<{ editor: ClipEditor }>()
const emit = defineEmits<{ seek: [outputMs: number] }>()
const hook = computed(() => props.editor.draft.value!.edit.hook)
const suggested = computed(() => props.editor.data.value?.clip.hook ?? null)

function field<K extends keyof HookSettings>(key: K) {
  return computed<HookSettings[K]>({
    get: () => hook.value[key],
    set: (v) => props.editor.update((d) => (d.edit.hook[key] = v), `hook-${String(key)}`),
  })
}
const enabled = field('enabled')
const text = field('text')
const style = field('style')
const durationMs = field('durationMs')
const y = field('y')

watch(enabled, (on) => {
  if (on) emit('seek', 300)
})

const labels: Record<HookStyleId, string> = { banner: 'Banner', bold: 'Bold', tag: 'Tag' }

// Static previews of each style with the current text.
const thumbs = ref<Record<string, HTMLCanvasElement | null>>({})
function paintThumbs() {
  for (const id of HOOK_STYLES) {
    const ctx = thumbs.value[id]?.getContext('2d')
    if (!ctx) continue
    const scale = 0.16
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.fillStyle = '#27272a'
    ctx.fillRect(0, 0, OUT_W, OUT_H)
    drawHook(ctx, { ...hook.value, enabled: true, style: id, y: 0.25, text: hook.value.text || 'Your hook here' }, 1000)
  }
}
watch(hook, () => nextTick(paintThumbs), { deep: true })
onMounted(async () => {
  await document.fonts.ready
  paintThumbs()
})
</script>

<template>
  <div class="space-y-5">
    <USwitch v-model="enabled" label="Show a hook" description="Text on screen for the first seconds, to stop the scroll." />

    <UFormField label="Text" :help="`${text.length}/160 · aim for 10 words or fewer`">
      <UTextarea v-model="text" :rows="2" autoresize :maxlength="160" placeholder="The one thing nobody tells you about…" class="w-full" />
    </UFormField>
    <UButton
      v-if="suggested && suggested !== text"
      :label="`Use Claude's hook: “${suggested}”`"
      icon="i-lucide-sparkles"
      color="neutral"
      variant="ghost"
      size="xs"
      class="-mt-3"
      @click="text = suggested!"
    />

    <div class="grid grid-cols-3 gap-2">
      <button
        v-for="id in HOOK_STYLES"
        :key="id"
        type="button"
        class="rounded-lg border p-1.5 transition hover:border-accented"
        :class="style === id ? 'border-primary ring-2 ring-primary/40' : 'border-default'"
        @click="style = id"
      >
        <canvas :ref="(el: unknown) => (thumbs[id] = el as HTMLCanvasElement)" :width="OUT_W * 0.16" :height="OUT_H * 0.16 * 0.5" class="w-full rounded-md" />
        <p class="mt-1 text-xs font-medium">{{ labels[id] }}</p>
      </button>
    </div>

    <UFormField :label="`On screen for · ${(durationMs / 1000).toFixed(1)} s`">
      <USlider v-model="durationMs" :min="1000" :max="8000" :step="250" />
    </UFormField>
    <UFormField :label="`Position · ${Math.round(y * 100)}% from the top`">
      <USlider v-model="y" :min="0.08" :max="0.6" :step="0.005" />
    </UFormField>
  </div>
</template>
