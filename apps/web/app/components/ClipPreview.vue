<script setup lang="ts">
import { formatTimecode } from '@clipstudio/core/shared'
/** A clip's first frame; click to play just that range of the preview copy. */
const props = defineProps<{ projectId: string; startMs: number; endMs: number; proxyVersion?: number }>()

const playing = ref(false)
const poster = computed(() => `/api/projects/${props.projectId}/frame?t=${props.startMs + 400}&w=480`)
// Media fragments make the browser start at the clip and stop at its end.
const src = computed(
  () => `/api/projects/${props.projectId}/media/proxy?v=${props.proxyVersion ?? 0}#t=${(props.startMs / 1000).toFixed(2)},${(props.endMs / 1000).toFixed(2)}`,
)
const length = computed(() => formatTimecode((props.endMs - props.startMs) / 1000))

defineExpose({ play: () => (playing.value = true) })
</script>

<template>
  <div class="relative aspect-video overflow-hidden rounded-md bg-black">
    <video v-if="playing" :src="src" autoplay controls class="size-full" @ended="playing = false" />
    <button v-else type="button" class="group block size-full" aria-label="Play clip" @click="playing = true">
      <img :src="poster" alt="" class="size-full object-cover" loading="lazy" />
      <span class="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/30">
        <span class="grid size-10 place-items-center rounded-full bg-black/60 text-white opacity-90 group-hover:scale-110">
          <UIcon name="i-lucide-play" class="size-5" />
        </span>
      </span>
      <span class="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
        {{ length }}
      </span>
    </button>
  </div>
</template>
