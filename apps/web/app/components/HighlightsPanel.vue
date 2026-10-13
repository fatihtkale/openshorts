<script setup lang="ts">
import { formatTimecode, type HighlightClip, type HotSpot, type ProjectDto } from '@clipstudio/core/shared'

/**
 * Where a long video or Twitch VOD gets interesting: a heat strip over the whole length (click to play) and the top
 * moments, from what viewers clipped on Twitch and sudden loud moments. Making a clip from a moment is the user's click.
 */
const props = defineProps<{ project: ProjectDto }>()
const emit = defineEmits<{ play: [startMs: number, endMs: number, cuts?: { start: number; end: number }[]] }>()
const toast = useToast()

interface Highlights {
  spots: HotSpot[]
  strip: number[]
  /** Excitement per second (0–1), for the zoomed range editor. */
  curve: number[]
  data: { viewerClipsStatus: 'ok' | 'none' | 'no-keys' | 'not-twitch' | 'error'; viewerClipsError?: string; viewerClips: HighlightClip[]; seconds: number } | null
  running: boolean
  twitchApp: boolean
}
const { data, refresh } = await useFetch<Highlights>(() => `/api/projects/${props.project.id}/highlights`, { server: false })
onJobStatusChange((job) => {
  if (job.type === 'media.highlights' && job.projectId === props.project.id) void refresh()
})

const isVod = computed(() => props.project.sourceMeta?.twitch?.kind === 'vod')
const visible = computed(() => !!data.value && (!!data.value.data || data.value.running || isVod.value))
const duration = computed(() => (props.project.durationMs ?? 0) / 1000)
const showAll = ref(false)
const spots = computed(() => (data.value?.spots ?? []).slice(0, showAll.value ? 40 : 8))
const tc = (s: number) => formatTimecode(s)

const status = computed(() => {
  const d = data.value?.data
  if (!d) return null
  switch (d.viewerClipsStatus) {
    case 'ok':
      return { tone: 'muted', text: `From ${d.viewerClips.length} viewer clips on Twitch and loud moments in the audio.` }
    case 'none':
      return { tone: 'muted', text: 'Nobody clipped this VOD on Twitch, so these come from loud moments in the audio.' }
    case 'no-keys':
      return { tone: 'warning', text: 'Only loud moments for now. Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to .env and restart the app to also see what viewers clipped.' }
    case 'error':
      return { tone: 'warning', text: `Twitch didn't answer (${d.viewerClipsError ?? 'unknown error'}); these come from loud moments only.` }
    default:
      return { tone: 'muted', text: 'From loud moments in the audio: shouting, laughter, hype.' }
  }
})

// The range being shaped in the editor below (seconds on the project's timeline).
const sel = ref<{ start: number; end: number } | null>(null)
const selCuts = ref<{ start: number; end: number }[]>([])
const selTitle = ref('')
const editor = ref<HTMLElement | null>(null)
function select(start: number, end: number, title: string) {
  sel.value = { start: Math.max(0, start), end: Math.min(duration.value, Math.max(end, start + 3)) }
  selCuts.value = []
  selTitle.value = title
  nextTick(() => editor.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
/** Title for a picked range: the most-viewed viewer clip inside it, else "Moment at …". */
function titleFor(start: number, end: number) {
  const inside = (data.value?.data?.viewerClips ?? []).filter((c) => c.startSec < end && c.startSec + c.durationSec > start)
  const top = inside.sort((a, b) => b.views - a.views)[0]
  return top?.title?.trim() || `Moment at ${tc(start + 3)}`
}

// Overview strip: hover shows the time; click plays from there; drag selects a range for the editor.
const hover = ref<{ x: number; sec: number } | null>(null)
const strip = ref<HTMLElement | null>(null)
const brush = ref<{ from: number; to: number } | null>(null)
function secAt(e: PointerEvent) {
  const box = strip.value!.getBoundingClientRect()
  const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
  return { x: f * box.width, sec: f * duration.value }
}
function onDown(e: PointerEvent) {
  brush.value = { from: secAt(e).sec, to: secAt(e).sec }
  strip.value!.setPointerCapture(e.pointerId)
}
function onMove(e: PointerEvent) {
  hover.value = secAt(e)
  if (brush.value) brush.value.to = hover.value.sec
}
function onUp() {
  const b = brush.value
  brush.value = null
  if (!b) return
  const a = Math.min(b.from, b.to)
  const z = Math.max(b.from, b.to)
  // A real drag (more than ~1% of the strip) selects; a click plays from just before that point.
  if (z - a > Math.max(3, duration.value * 0.01)) select(a, z, titleFor(a, z))
  else {
    const s = Math.max(0, b.from - 3)
    emit('play', s * 1000, Math.min(duration.value, s + 30) * 1000)
  }
}
const stripPct = (sec: number) => (sec / Math.max(1, duration.value)) * 100

const making = ref<number | null>(null)
async function makeClip(spot: HotSpot, i: number) {
  await createClip(spot.startSec, spot.endSec, titleFor(spot.startSec, spot.endSec), i)
}
async function createClip(start: number, end: number, title: string, key: number, cuts: { start: number; end: number }[] = []) {
  making.value = key
  try {
    const post = $fetch as unknown as (url: string, opts: { method: 'POST'; body: unknown }) => Promise<unknown>
    await post(`/api/projects/${props.project.id}/clips`, {
      method: 'POST',
      body: {
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        title: title.trim().slice(0, 120) || `Moment at ${tc(start)}`,
        cuts: cuts.map((c) => ({ start: Math.round(c.start * 1000), end: Math.round(c.end * 1000) })),
      },
    })
    toast.add({ title: 'Clip added', description: 'Rename and edit it from the Clips list.', icon: 'i-lucide-scissors' })
    useClipsVersion().value++
  } catch (e) {
    toast.add({ title: 'Could not make the clip', description: (e as { statusMessage?: string }).statusMessage ?? (e as Error).message, color: 'error' })
  } finally {
    making.value = null
  }
}

const finding = ref(false)
async function findAgain() {
  finding.value = true
  try {
    await $fetch(`/api/projects/${props.project.id}/highlights`, { method: 'POST' })
    await refresh()
  } finally {
    finding.value = false
  }
}

const prompt = computed(() => `Find the best clips in the hot spots of my Clip Studio project “${props.project.name}”`)
async function copyPrompt() {
  await navigator.clipboard.writeText(prompt.value)
  toast.add({ title: 'Copied', description: 'Paste it into Claude.', icon: 'i-lucide-clipboard-check' })
}
</script>

<template>
  <UCard v-if="visible">
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="font-semibold">Highlights</h2>
        <span v-if="data?.spots.length" class="text-xs text-muted">{{ data.spots.length }} moments</span>
        <div class="ml-auto flex items-center gap-2">
          <UButton
            v-if="data?.data && data.twitchApp && data.data.viewerClipsStatus === 'no-keys'"
            label="Find again"
            icon="i-lucide-rotate-cw"
            color="neutral"
            variant="outline"
            size="xs"
            :loading="finding || data.running"
            @click="findAgain"
          />
          <UButton icon="i-lucide-copy" label="Ask Claude" color="neutral" variant="ghost" size="xs" @click="copyPrompt" />
        </div>
      </div>
    </template>

    <div v-if="!data?.data" class="flex items-center gap-2 text-sm text-muted">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
      {{ data?.running ? 'Listening for the loud moments and asking Twitch what viewers clipped…' : 'Highlights appear once the video is ready.' }}
    </div>

    <div v-else class="space-y-4">
      <!-- Heat strip: one column per slice of the video, taller = hotter. Click to play from there. -->
      <div>
        <div
          ref="strip"
          class="relative flex h-14 cursor-pointer items-end gap-px"
          role="img"
          :aria-label="`How exciting each part of the video is, over ${tc(duration)}`"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointerleave="hover = null"
        >
          <span
            v-for="(v, i) in data.strip"
            :key="i"
            class="flex-1 rounded-t-[2px] bg-primary"
            :style="{ height: `${Math.max(4, v * 100)}%`, opacity: 0.25 + 0.75 * v }"
          />
          <span
            v-if="sel"
            class="pointer-events-none absolute inset-y-0 rounded-sm border-x-2 border-primary bg-primary/15"
            :style="{ left: `${stripPct(sel.start)}%`, width: `${Math.max(0.4, stripPct(sel.end) - stripPct(sel.start))}%` }"
          />
          <span
            v-if="brush"
            class="pointer-events-none absolute inset-y-0 bg-primary/20"
            :style="{ left: `${stripPct(Math.min(brush.from, brush.to))}%`, width: `${Math.abs(stripPct(brush.to) - stripPct(brush.from))}%` }"
          />
          <span v-if="hover" class="pointer-events-none absolute inset-y-0 w-px bg-default" :style="{ left: `${hover.x}px` }" />
          <span
            v-if="hover"
            class="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-inverted px-1.5 py-0.5 text-xs whitespace-nowrap text-inverted tabular-nums"
            :style="{ left: `${hover.x}px` }"
          >{{ tc(hover.sec) }} · click to play, drag to pick a range</span>
        </div>
        <div class="mt-1 flex justify-between text-xs text-dimmed tabular-nums">
          <span>0:00</span><span>{{ tc(duration / 2) }}</span><span>{{ tc(duration) }}</span>
        </div>
      </div>

      <p v-if="status" class="text-xs" :class="status.tone === 'warning' ? 'text-warning' : 'text-muted'">{{ status.text }}</p>

      <!-- Range editor: shape the exact clip before making it -->
      <div v-if="sel" ref="editor" class="space-y-3 rounded-lg border border-primary/40 p-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-scissors" class="size-4 text-primary" />
          <p class="flex-1 text-sm font-medium">Shape the clip</p>
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" aria-label="Close" @click="sel = null" />
        </div>
        <HighlightRange
          v-model="sel"
          v-model:cuts="selCuts"
          :curve="data.curve"
          :duration="duration"
          :viewer-clips="data.data.viewerClips"
          @play="(a, b, c) => emit('play', a, b, c)"
        />
        <div class="flex flex-wrap items-end gap-2">
          <UFormField label="Title" size="sm" class="min-w-48 flex-1">
            <UInput v-model="selTitle" maxlength="120" class="w-full" />
          </UFormField>
          <UButton label="Make clip" icon="i-lucide-scissors" size="sm" :loading="making === -1" @click="createClip(sel.start, sel.end, selTitle, -1, selCuts)" />
        </div>
      </div>

      <ol v-if="spots.length" class="divide-y divide-default">
        <li v-for="(s, i) in spots" :key="s.peakSec" class="flex flex-wrap items-center gap-3 py-2">
          <span class="w-5 text-right text-sm font-semibold text-muted tabular-nums">{{ i + 1 }}</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium tabular-nums">{{ tc(s.startSec) }}–{{ tc(s.endSec) }}</p>
            <p class="text-xs text-muted">{{ s.reasons.join(' · ') }}</p>
          </div>
          <div class="h-1.5 w-16 rounded-full bg-primary/15" :title="`Score ${Math.round(s.score * 100)}`">
            <div class="h-full rounded-full bg-primary" :style="{ width: `${s.score * 100}%` }" />
          </div>
          <UButton icon="i-lucide-play" color="neutral" variant="ghost" size="xs" aria-label="Play this moment" @click="emit('play', s.startSec * 1000, s.endSec * 1000)" />
          <UButton
            label="Adjust"
            icon="i-lucide-sliders-horizontal"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="select(s.startSec, s.endSec, titleFor(s.startSec, s.endSec))"
          />
          <UButton label="Make clip" icon="i-lucide-scissors" color="neutral" variant="outline" size="xs" :loading="making === i" @click="makeClip(s, i)" />
        </li>
      </ol>
      <p v-else class="text-sm text-muted">No clear hot spots: the video is about equally loud throughout.</p>
      <UButton
        v-if="(data.spots.length ?? 0) > 8"
        :label="showAll ? 'Show fewer' : `Show all ${data.spots.length}`"
        color="neutral"
        variant="link"
        size="xs"
        class="p-0"
        @click="showAll = !showAll"
      />
    </div>
  </UCard>
</template>
