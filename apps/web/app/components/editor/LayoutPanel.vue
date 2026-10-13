<script setup lang="ts">
import {
  centreAt,
  DEFAULT_SCREEN,
  facecamWindow,
  fillRect,
  MAX_FACECAM_ZOOM,
  OUT_W,
  screenPanels,
  formatTimecodeMs,
  outputToSource,
  panelRect,
  type LayoutMode,
  type Rect,
} from '~/utils/editor'
import type { ClipEditor } from '~/composables/useClipEditor'

/**
 * Frames the shot: the whole source frame with the 9:16 window (fill), the two 9:8 windows (split) or the
 * screen and face windows (screen) drawn on top. Drag a window to move it.
 */
const props = defineProps<{ editor: ClipEditor; video: HTMLVideoElement | undefined; time: number }>()
const emit = defineEmits<{ seek: [outputMs: number] }>()

const draft = computed(() => props.editor.draft.value!)
const layout = computed(() => draft.value.edit.layout)
const canvas = ref<HTMLCanvasElement>()
const width = 560

/** Source time of the playhead, relative to the clip start (keyframes count from there). */
const clipTime = computed(() => outputToSource(props.editor.segments.value, props.time) - draft.value.startMs)

const mode = computed({
  get: () => layout.value.mode,
  set: (m: LayoutMode) =>
    props.editor.update((d) => {
      d.edit.layout.mode = m
      // First time in screen mode: start with the face window on the speaker, if faces were analysed.
      if (m === 'screen' && !d.edit.layout.screen) {
        d.edit.layout.screen = structuredClone(DEFAULT_SCREEN)
        const found = findFace(d.edit.layout)
        if (found) d.edit.layout.screen.face = found
      }
    }),
})
const zoom = computed({
  get: () => layout.value.zoom,
  set: (z: number) => props.editor.update((d) => (d.edit.layout.zoom = z), 'layout-zoom'),
})
const { active } = useJobs()
const project = computed(() => props.editor.data.value?.project)
const analysing = computed(() => active.value.find((j) => j.type === 'media.faces' && j.projectId === project.value?.id))
const hasTrack = computed(() => !!props.editor.faceTrack.value)
const follow = computed({
  get: () => !!layout.value.auto,
  set: (on: boolean) => props.editor.update((d) => (d.edit.layout.auto = on)),
})
const toast = useToast()
async function analyse() {
  try {
    await $fetch(`/api/projects/${project.value!.id}/faces`, { method: 'POST' })
  } catch (e) {
    toast.add({ title: 'Could not start face analysis', description: (e as Error).message, color: 'error' })
  }
}

const animate = computed({
  get: () => layout.value.keyframes.length > 1,
  set: (on: boolean) => {
    if (on) {
      // Start a move: keep the current window here, and add one at the clip's end to drag.
      const c = centreAt(layout.value.keyframes, clipTime.value)
      const end = draft.value.endMs - draft.value.startMs
      props.editor.update((d) => (d.edit.layout.keyframes = [{ t: 0, ...c }, { t: end, ...c }]))
    } else {
      const c = centreAt(layout.value.keyframes, clipTime.value)
      props.editor.update((d) => (d.edit.layout.keyframes = [{ t: 0, ...c }]))
    }
  },
})

function size() {
  const project = props.editor.data.value?.project
  const vw = props.video?.videoWidth || project?.width || 1920
  const vh = props.video?.videoHeight || project?.height || 1080
  return { vw, vh, scale: width / vw, height: Math.round((width * vh) / vw) }
}

type WindowKey = 'fill' | 'top' | 'bottom' | 'screen' | 'face'

/** The face window's position from the face track, sized to the space the screen leaves. */
function findFace(l: typeof layout.value) {
  const track = props.editor.faceTrack.value
  if (!track) return null
  const { vw, vh } = size()
  const aspect = OUT_W / screenPanels(l, vw, vh).face.out.h
  return facecamWindow(track, { start: draft.value.startMs, end: draft.value.endMs }, aspect, vw, vh)
}

function windows(): { key: WindowKey; label: string; rect: Rect; colour: string }[] {
  const { vw, vh } = size()
  if (layout.value.mode === 'fill') {
    const drawn = props.editor.layout.value ?? layout.value
    return [{ key: 'fill', label: '', rect: fillRect(drawn, vw, vh, clipTime.value), colour: drawn.auto && hasTrack.value ? '#22c55e' : '#a78bfa' }]
  }
  if (layout.value.mode === 'split') {
    return [
      { key: 'top', label: 'TOP', rect: panelRect(layout.value.split.top, vw, vh), colour: '#a78bfa' },
      { key: 'bottom', label: 'BOTTOM', rect: panelRect(layout.value.split.bottom, vw, vh), colour: '#fb923c' },
    ]
  }
  if (layout.value.mode === 'screen') {
    const p = screenPanels(layout.value, vw, vh)
    // Face first so it wins the click when it sits inside the screen window (it usually does).
    return [
      { key: 'face', label: 'FACE', rect: p.face.src, colour: '#fb923c' },
      { key: 'screen', label: 'SCREEN', rect: p.screen.src, colour: '#a78bfa' },
    ]
  }
  return []
}

let frame = 0
function draw() {
  const c = canvas.value
  const ctx = c?.getContext('2d')
  if (c && ctx) {
    const { scale, height } = size()
    if (c.height !== height) c.height = height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, c.width, c.height)
    if (props.video && props.video.readyState >= 2) ctx.drawImage(props.video, 0, 0, c.width, c.height)
    const wins = windows()
    if (wins.length) {
      // Dim everything outside the windows.
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.beginPath()
      ctx.rect(0, 0, c.width, c.height)
      for (const w of wins) ctx.rect(w.rect.x * scale, w.rect.y * scale, w.rect.w * scale, w.rect.h * scale)
      ctx.fill('evenodd')
      ctx.restore()
      for (const w of wins) {
        ctx.strokeStyle = w.colour
        ctx.lineWidth = 3
        ctx.strokeRect(w.rect.x * scale, w.rect.y * scale, w.rect.w * scale, w.rect.h * scale)
        if (w.label) {
          ctx.fillStyle = w.colour
          ctx.font = '700 13px Inter'
          ctx.fillText(w.label, w.rect.x * scale + 8, w.rect.y * scale + 18)
        }
      }
    }
  }
  frame = requestAnimationFrame(draw)
}
onMounted(() => (frame = requestAnimationFrame(draw)))
onBeforeUnmount(() => cancelAnimationFrame(frame))

// ── Dragging ─────────────────────────────────────────────────────────
let drag: { key: WindowKey; dx: number; dy: number } | null = null

function pointer(e: PointerEvent) {
  const box = canvas.value!.getBoundingClientRect()
  const { scale } = size()
  const k = box.width / width
  return { x: (e.clientX - box.left) / k / scale, y: (e.clientY - box.top) / k / scale }
}

function onDown(e: PointerEvent) {
  const p = pointer(e)
  const hit = windows().find((w) => p.x >= w.rect.x && p.x <= w.rect.x + w.rect.w && p.y >= w.rect.y && p.y <= w.rect.y + w.rect.h)
  if (!hit) return
  drag = { key: hit.key, dx: p.x - (hit.rect.x + hit.rect.w / 2), dy: p.y - (hit.rect.y + hit.rect.h / 2) }
  canvas.value!.setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent) {
  if (!drag) return
  const { vw, vh } = size()
  const p = pointer(e)
  const x = Math.min(1, Math.max(0, (p.x - drag.dx) / vw))
  const y = Math.min(1, Math.max(0, (p.y - drag.dy) / vh))
  const key = drag.key
  props.editor.update((d) => {
    const l = d.edit.layout
    if (key === 'top' || key === 'bottom') {
      l.split[key].x = x
      l.split[key].y = y
    } else if (key === 'screen' || key === 'face') {
      l.screen ??= structuredClone(DEFAULT_SCREEN)
      l.screen[key].x = x
      l.screen[key].y = y
    } else if (l.auto) {
      // Taking over by hand: stop following faces and hold the window here.
      l.auto = false
      l.keyframes = [{ t: 0, x, y }]
    } else if (l.keyframes.length === 1) {
      l.keyframes[0] = { t: 0, x, y }
    } else {
      // Moving: change the keyframe at the playhead, or add one.
      const t = Math.round(clipTime.value)
      const near = l.keyframes.find((k) => Math.abs(k.t - t) < 200)
      if (near) Object.assign(near, { x, y })
      else l.keyframes.push({ t, x, y })
      l.keyframes.sort((a, b) => a.t - b.t)
    }
  }, `layout-drag-${key}`)
}

function onUp() {
  drag = null
}

function removeKeyframe(t: number) {
  props.editor.update((d) => {
    d.edit.layout.keyframes = d.edit.layout.keyframes.filter((k) => k.t !== t)
  })
}

function centre() {
  props.editor.update((d) => {
    d.edit.layout.keyframes = [{ t: 0, x: 0.5, y: 0.5 }]
    d.edit.layout.zoom = 1
  })
}

function splitZoom(key: 'top' | 'bottom') {
  return computed({
    get: () => layout.value.split[key].zoom,
    set: (z: number) => props.editor.update((d) => (d.edit.layout.split[key].zoom = z), `split-zoom-${key}`),
  })
}
const topZoom = splitZoom('top')
const bottomZoom = splitZoom('bottom')

function screenZoom(key: 'screen' | 'face') {
  return computed({
    get: () => (layout.value.screen ?? DEFAULT_SCREEN)[key].zoom,
    set: (z: number) =>
      props.editor.update((d) => {
        d.edit.layout.screen ??= structuredClone(DEFAULT_SCREEN)
        d.edit.layout.screen[key].zoom = z
      }, `screen-zoom-${key}`),
  })
}
const screenAreaZoom = screenZoom('screen')
const faceZoom = screenZoom('face')
const faceOnTop = computed({
  get: () => (layout.value.screen ?? DEFAULT_SCREEN).faceOnTop,
  set: (on: boolean) =>
    props.editor.update((d) => {
      d.edit.layout.screen ??= structuredClone(DEFAULT_SCREEN)
      d.edit.layout.screen.faceOnTop = on
    }),
})
function placeFace() {
  const found = findFace(layout.value)
  if (!found) {
    toast.add({ title: 'No face found in this clip', description: 'Drag the orange box onto the speaker instead.', color: 'warning' })
    return
  }
  props.editor.update((d) => {
    d.edit.layout.screen ??= structuredClone(DEFAULT_SCREEN)
    d.edit.layout.screen.face = found
  })
}

/** Output time of a keyframe, for jumping to it. */
function seekToKeyframe(t: number) {
  const src = draft.value.startMs + t
  const segs = props.editor.segments.value
  let offset = 0
  for (const s of segs) {
    if (src < s.end) {
      emit('seek', offset + Math.max(0, src - s.start))
      return
    }
    offset += s.end - s.start
  }
}

const modes = [
  { label: 'Fill', value: 'fill', icon: 'i-lucide-crop', description: 'Crop to vertical, follow the action' },
  { label: 'Fit', value: 'fit', icon: 'i-lucide-rectangle-horizontal', description: 'Whole frame on a blurred background' },
  { label: 'Split', value: 'split', icon: 'i-lucide-rows-2', description: 'Two parts of the frame, stacked' },
  { label: 'Screen', value: 'screen', icon: 'i-lucide-monitor-smartphone', description: 'Screen recording with your face below' },
]
</script>

<template>
  <div class="space-y-5">
    <div class="grid grid-cols-2 gap-2">
      <button
        v-for="m in modes"
        :key="m.value"
        type="button"
        class="rounded-lg border p-3 text-left transition hover:border-accented"
        :class="mode === m.value ? 'border-primary ring-2 ring-primary/40' : 'border-default'"
        @click="mode = m.value as LayoutMode"
      >
        <UIcon :name="m.icon" class="size-5 text-primary" />
        <p class="mt-1 text-sm font-medium">{{ m.label }}</p>
        <p class="text-xs text-muted">{{ m.description }}</p>
      </button>
    </div>

    <div v-if="mode !== 'fit'">
      <canvas
        ref="canvas"
        :width="width"
        height="315"
        class="w-full cursor-grab touch-none rounded-lg active:cursor-grabbing"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      />
      <p class="mt-2 text-xs text-muted">
        Drag the {{ mode === 'fill' ? 'box' : 'boxes' }} to choose what's on screen.
        <template v-if="mode === 'fill' && animate">Dragging sets the position at the playhead.</template>
      </p>
    </div>
    <p v-else class="text-sm text-muted">The whole frame is shown, centred on a soft, blurred copy of itself. Nothing to frame.</p>

    <template v-if="mode === 'fill'">
      <div class="rounded-lg border border-default p-3">
        <USwitch v-model="follow" label="Follow faces" description="The crop keeps the main speaker in frame and cuts with the shots." />
        <p class="mt-2 pl-11 text-xs text-muted">
          <template v-if="analysing">
            Looking for faces… {{ Math.round(analysing.progress * 100) }}%
          </template>
          <template v-else-if="hasTrack && editor.coverage.value !== null">
            {{ editor.coverage.value > 0.05 ? `A face is visible in ${Math.round(editor.coverage.value * 100)}% of this clip.` : 'No faces found in this clip, so it stays centred.' }}
            <template v-if="follow"> Drag the box to take over by hand.</template>
          </template>
          <template v-else>
            Faces haven't been analysed for this video yet.
            <UButton label="Find faces" size="xs" color="neutral" variant="link" class="p-0" @click="analyse" />
          </template>
        </p>
      </div>
      <UFormField :label="`Zoom · ${zoom.toFixed(1)}×`">
        <USlider v-model="zoom" :min="1" :max="3" :step="0.05" />
      </UFormField>
      <div v-if="!follow || !hasTrack" class="flex flex-wrap items-center gap-4">
        <USwitch v-model="animate" label="Move over time" description="Pan between positions, like a camera operator." />
        <UButton label="Centre" icon="i-lucide-focus" color="neutral" variant="outline" size="sm" class="ml-auto" @click="centre" />
      </div>
      <div v-if="animate && (!follow || !hasTrack)" class="flex flex-wrap gap-2">
        <UBadge
          v-for="k in layout.keyframes"
          :key="k.t"
          color="neutral"
          variant="outline"
          class="cursor-pointer gap-1"
          @click="seekToKeyframe(k.t)"
        >
          <UIcon name="i-lucide-diamond" class="size-3 text-primary" />
          {{ formatTimecodeMs(k.t) }}
          <UButton
            v-if="layout.keyframes.length > 2"
            icon="i-lucide-x"
            color="neutral"
            variant="link"
            size="xs"
            class="-my-1 p-0"
            aria-label="Remove keyframe"
            @click.stop="removeKeyframe(k.t)"
          />
        </UBadge>
      </div>
    </template>

    <template v-if="mode === 'screen'">
      <div class="flex flex-wrap items-center gap-4">
        <USwitch v-model="faceOnTop" label="Face on top" description="Put the face above the screen instead of below." />
        <UButton
          v-if="hasTrack"
          label="Find my face"
          icon="i-lucide-scan-face"
          color="neutral"
          variant="outline"
          size="sm"
          class="ml-auto"
          @click="placeFace"
        />
        <UButton v-else-if="!analysing" label="Find faces" icon="i-lucide-scan-face" color="neutral" variant="outline" size="sm" class="ml-auto" @click="analyse" />
        <span v-else class="ml-auto text-xs text-muted">Looking for faces… {{ Math.round(analysing.progress * 100) }}%</span>
      </div>
      <UFormField :label="`Screen zoom · ${screenAreaZoom.toFixed(1)}×`" description="Zoom in to cut off toolbars or your camera's corner.">
        <USlider v-model="screenAreaZoom" :min="1" :max="3" :step="0.05" />
      </UFormField>
      <UFormField :label="`Face zoom · ${faceZoom.toFixed(1)}×`">
        <USlider v-model="faceZoom" :min="1" :max="MAX_FACECAM_ZOOM" :step="0.05" />
      </UFormField>
    </template>

    <template v-if="mode === 'split'">
      <UFormField :label="`Top zoom · ${topZoom.toFixed(1)}×`">
        <USlider v-model="topZoom" :min="1" :max="3" :step="0.05" />
      </UFormField>
      <UFormField :label="`Bottom zoom · ${bottomZoom.toFixed(1)}×`">
        <USlider v-model="bottomZoom" :min="1" :max="3" :step="0.05" />
      </UFormField>
    </template>
  </div>
</template>
