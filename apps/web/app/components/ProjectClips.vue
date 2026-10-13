<script setup lang="ts">
import { evaluationState, formatTimecode, verdict, type ClipDto, type ProjectDto } from '@clipstudio/core/shared'

const props = defineProps<{ project: ProjectDto }>()
const emit = defineEmits<{ play: [startMs: number, endMs: number] }>()
const toast = useToast()

const version = useClipsVersion()
const { data: clips, refresh } = await useFetch<ClipDto[]>(() => `/api/projects/${props.project.id}/clips`, {
  query: { status: 'approved,proposed' },
  default: () => [],
  server: false,
})
const { pending: inboxCount } = useInboxCount()
watch([version, inboxCount], () => void refresh())

const approved = computed(() => clips.value.filter((c) => c.status === 'approved'))
/** Approved clips without an up-to-date evaluation. */
const unscored = computed(() => approved.value.filter((c) => !c.evaluation || evaluationState(c.evaluation, c) === 'stale').slice(0, 20))
const { jobs } = useJobs()
onJobStatusChange((job) => {
  if (job.type === 'clip.render' && job.projectId === props.project.id) void refresh()
})

/** Export state of a clip, as a short label. */
function exportState(clip: ClipDto): { label: string; tone: 'muted' | 'success' | 'warning' | 'error'; busy: boolean } | null {
  const r = clip.render
  if (!r) return null
  const job = jobs.value.find((j) => j.subjectId === r.id && (j.status === 'queued' || j.status === 'running'))
  if (job) return { label: job.status === 'running' ? `Exporting ${Math.round(job.progress * 100)}%` : 'Waiting to export', tone: 'muted', busy: true }
  if (r.status === 'failed') return { label: 'Export failed', tone: 'error', busy: false }
  if (r.status !== 'done') return { label: 'Waiting to export', tone: 'muted', busy: true }
  return r.clipVersion < clip.version
    ? { label: 'Exported (edited since)', tone: 'warning', busy: false }
    : { label: 'Exported', tone: 'success', busy: false }
}

const needsExport = computed(() =>
  approved.value.filter((c) => !c.render || c.render.status === 'failed' || (c.render.status === 'done' && c.render.clipVersion < c.version)),
)
const exportAllOpen = ref(false)
const exporting = ref(false)
async function exportAll() {
  exporting.value = true
  try {
    const { started } = await $fetch<{ started: number }>(`/api/projects/${props.project.id}/render-all`, { method: 'POST' })
    toast.add({ title: `${started} ${started === 1 ? 'export' : 'exports'} started`, icon: 'i-lucide-film' })
    exportAllOpen.value = false
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not start the exports', description: (e as Error).message, color: 'error' })
  } finally {
    exporting.value = false
  }
}
const waiting = computed(() => clips.value.filter((c) => c.status === 'proposed').length)

const { data: mcp } = await useFetch<{ client: string | null; lastSeen: number | null }>('/api/mcp-status', { server: false })
const prompt = computed(() => `Find the best clips in the Clip Studio project "${props.project.name}"`)

async function copyPrompt() {
  await navigator.clipboard.writeText(prompt.value)
  toast.add({ title: 'Copied', description: 'Paste it into Claude.', icon: 'i-lucide-clipboard-check' })
}

async function remove(clip: ClipDto) {
  try {
    await $fetch(`/api/clips/${clip.id}/status`, { method: 'POST', body: { status: 'rejected' } })
    toast.add({
      title: 'Clip removed',
      description: clip.title,
      actions: [{ label: 'Undo', onClick: () => void restore(clip) }],
    })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not remove the clip', description: (e as Error).message, color: 'error' })
  }
}

async function restore(clip: ClipDto) {
  await $fetch(`/api/clips/${clip.id}/status`, { method: 'POST', body: { status: 'approved' } })
  await refresh()
}
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex items-center gap-2">
        <h2 class="font-semibold">Clips</h2>
        <span v-if="approved.length" class="text-xs text-muted">{{ approved.length }}</span>
        <div class="ml-auto flex items-center gap-2">
          <FindClipsButton :project="project" />
          <EvaluateButton
            v-if="unscored.length && project.transcript?.status === 'ready'"
            :project-id="project.id"
            :clip-ids="unscored.map((c) => c.id)"
            :label="`Evaluate ${unscored.length}`"
            size="xs"
            @done="refresh()"
          />
          <UButton
            v-if="needsExport.length > 1"
            :label="`Export all ${needsExport.length}`"
            icon="i-lucide-film"
            color="neutral"
            variant="outline"
            size="xs"
            @click="exportAllOpen = true"
          />
        </div>
      </div>
    </template>

    <UAlert
      v-if="waiting"
      color="primary"
      variant="subtle"
      icon="i-lucide-inbox"
      :title="`${waiting} ${waiting === 1 ? 'clip is' : 'clips are'} waiting for your review`"
      :actions="[{ label: 'Open Inbox', to: '/inbox', color: 'primary', variant: 'solid', size: 'xs' }]"
      class="m-4 w-auto"
    />

    <ul v-if="approved.length" class="divide-y divide-default">
      <li v-for="clip in approved" :key="clip.id" class="group flex items-center gap-3 px-4 py-2.5 sm:px-6">
        <button type="button" class="relative shrink-0 overflow-hidden rounded" aria-label="Play clip" @click="emit('play', clip.startMs, clip.endMs)">
          <img :src="`/api/projects/${project.id}/frame?t=${clip.startMs + 400}&w=320`" alt="" class="aspect-video w-24 object-cover" loading="lazy" />
          <span class="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
            <UIcon name="i-lucide-play" class="size-5 text-white" />
          </span>
        </button>
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 text-sm font-medium">
            <span class="truncate">{{ clip.title }}</span>
            <UBadge
              v-if="clip.evaluation"
              :label="`${clip.evaluation.total.toFixed(1)}/10`"
              :icon="verdict(clip.evaluation.total).icon"
              :color="evaluationState(clip.evaluation, clip) === 'stale' ? 'neutral' : verdict(clip.evaluation.total).tone"
              variant="subtle"
              size="sm"
              class="shrink-0"
              :title="evaluationState(clip.evaluation, clip) === 'stale' ? 'Evaluated before the clip changed' : verdict(clip.evaluation.total).label"
            />
          </p>
          <p class="text-xs text-muted tabular-nums">
            {{ formatTimecode(clip.startMs / 1000) }}–{{ formatTimecode(clip.endMs / 1000) }} · {{ formatTimecode((clip.endMs - clip.startMs) / 1000) }}
            · {{ clip.origin === 'claude' ? 'by Claude' : clip.origin === 'imported' ? 'Twitch clip' : 'made by you' }}
            <template v-if="exportState(clip)">
              ·
              <span
                :class="{
                  'text-success': exportState(clip)!.tone === 'success',
                  'text-warning': exportState(clip)!.tone === 'warning',
                  'text-error': exportState(clip)!.tone === 'error',
                }"
              >{{ exportState(clip)!.label }}</span>
            </template>
          </p>
        </div>
        <ConfirmButton label="Remove" confirm-label="Remove clip?" class="opacity-0 group-hover:opacity-100 focus:opacity-100" @confirm="remove(clip)" />
        <UButton
          v-if="clip.render?.status === 'done'"
          icon="i-lucide-download"
          color="neutral"
          variant="ghost"
          size="sm"
          :to="`/api/renders/${clip.render.id}/download`"
          external
          download
          aria-label="Download export"
        />
        <UButton label="Edit" icon="i-lucide-pencil" color="neutral" variant="outline" size="sm" :to="`/clips/${clip.id}`" />
      </li>
    </ul>

    <div v-else-if="!waiting" class="space-y-3 p-4 text-sm sm:px-6">
      <p class="text-muted">No clips yet. Ask Claude to find the best moments:</p>
      <div class="flex items-center gap-2 rounded-md border border-default p-2">
        <UIcon name="i-lucide-sparkles" class="size-4 shrink-0 text-primary" />
        <span class="flex-1">“{{ prompt }}”</span>
        <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" aria-label="Copy prompt" @click="copyPrompt" />
      </div>
      <p class="text-xs text-muted">
        <template v-if="!mcp?.lastSeen">
          Claude isn't connected yet. <ULink to="/settings" class="text-primary">Connect Claude</ULink> first, or turn on in-app AI there.
        </template>
        Or select words in the transcript to make a clip yourself.
      </p>
    </div>
  </UCard>

  <UModal
    v-model:open="exportAllOpen"
    :title="`Export ${needsExport.length} clips?`"
    description="Each becomes a vertical 1080×1920 MP4 with its own captions, hook and layout. They're made one at a time on this Mac."
  >
    <template #body>
      <ul class="space-y-1 text-sm">
        <li v-for="c in needsExport" :key="c.id" class="flex justify-between gap-4">
          <span class="truncate">{{ c.title }}</span>
          <span class="shrink-0 text-muted tabular-nums">{{ formatTimecode((c.endMs - c.startMs) / 1000) }}</span>
        </li>
      </ul>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="exportAllOpen = false" />
        <UButton :label="`Export ${needsExport.length} clips`" icon="i-lucide-film" :loading="exporting" @click="exportAll" />
      </div>
    </template>
  </UModal>
</template>
