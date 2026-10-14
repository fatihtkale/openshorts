<script setup lang="ts">
import { evaluationState, formatTimecode, needsExport, verdict, type LibraryClip } from '@clipstudio/core/shared'

/**
 * Every clip from every project in one place: search, filter by project, hide what's already uploaded, and click a
 * clip to open it in the editor. Select some (or take all shown) to export them in one go, after a confirm.
 * (A project's own page still lists its clips next to the video.)
 */
const toast = useToast()
const { data: items, refresh } = await useFetch<LibraryClip[]>('/api/clips', { default: () => [], server: false })
const version = useClipsVersion()
const { pending: inboxCount } = useInboxCount()
watch([version, inboxCount], () => void refresh())
onJobStatusChange((job) => {
  if (job.type === 'clip.render' || job.type === 'post.publish') void refresh()
})
const { jobs } = useJobs()

// Filters; "hide uploaded" is remembered on this Mac.
const search = ref('')
const project = ref<string>('all')
const HIDE_KEY = 'clips.hideUploaded'
const hideUploaded = ref(true)
onMounted(() => {
  try {
    hideUploaded.value = localStorage.getItem(HIDE_KEY) !== 'false'
  } catch {
    // No storage (private window): keep the default.
  }
})
watch(hideUploaded, (v) => {
  try {
    localStorage.setItem(HIDE_KEY, String(v))
  } catch {
    // Not remembered; fine.
  }
})

const projectItems = computed(() => [
  { label: 'All projects', value: 'all' },
  ...[...new Map(items.value.map((i) => [i.clip.projectId, i.projectName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ label, value })),
])
const uploadedCount = computed(() => items.value.filter((i) => i.uploaded > 0).length)
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter(
    (i) =>
      (!hideUploaded.value || i.uploaded === 0) &&
      (project.value === 'all' || i.clip.projectId === project.value) &&
      (!q || i.clip.title.toLowerCase().includes(q) || i.projectName.toLowerCase().includes(q)),
  )
})

/** Export state of a clip, as a short label. */
function exportState(i: LibraryClip): { label: string; color: 'neutral' | 'success' | 'warning' | 'error' } {
  const r = i.clip.render
  if (!r) return { label: 'Not exported', color: 'neutral' }
  const job = jobs.value.find((j) => j.subjectId === r.id && (j.status === 'queued' || j.status === 'running'))
  if (job) return { label: job.status === 'running' ? `Exporting ${Math.round(job.progress * 100)}%` : 'Waiting to export', color: 'neutral' }
  if (r.status === 'failed') return { label: 'Export failed', color: 'error' }
  if (r.status !== 'done') return { label: 'Waiting to export', color: 'neutral' }
  return r.clipVersion < i.clip.version ? { label: 'Edited since export', color: 'warning' } : { label: 'Exported', color: 'success' }
}
const length = (i: LibraryClip) => formatTimecode((i.clip.endMs - i.clip.startMs) / 1000)

// ── Selecting and exporting ──────────────────────────────────────────
const selecting = ref(false)
const selected = ref<string[]>([])
function toggle(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id]
}
function stopSelecting() {
  selecting.value = false
  selected.value = []
}
/** Exporting right now (or waiting to): another export would only queue behind it. */
const busy = (i: LibraryClip) => i.clip.render?.status === 'queued' || i.clip.render?.status === 'running'
const exportable = (i: LibraryClip) => needsExport(i.clip) && !busy(i)
/** All shown clips that need an export: never exported, failed, or edited since. */
const allToExport = computed(() => shown.value.filter(exportable))

const confirmOpen = ref(false)
const exportList = ref<LibraryClip[]>([])
const exportSkipped = ref(0)
function askExport(list: LibraryClip[]) {
  exportList.value = list.filter(exportable)
  exportSkipped.value = list.length - exportList.value.length
  confirmOpen.value = true
}
const exporting = ref(false)
async function runExport() {
  exporting.value = true
  try {
    const res = await $fetch<{ started: number; upToDate: number; failed: { clipId: string; error: string }[] }>('/api/renders', {
      method: 'POST',
      body: { clipIds: exportList.value.map((i) => i.clip.id) },
    })
    toast.add({
      title: `${res.started} ${res.started === 1 ? 'export' : 'exports'} started`,
      description: res.failed.length ? `${res.failed.length} couldn't start: ${res.failed[0]!.error}` : 'They run one at a time on this Mac.',
      icon: 'i-lucide-film',
      color: res.failed.length ? 'warning' : 'success',
    })
    confirmOpen.value = false
    stopSelecting()
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not start the exports', description: (e as { statusMessage?: string }).statusMessage ?? (e as Error).message, color: 'error' })
  } finally {
    exporting.value = false
  }
}
const totalLength = computed(() => formatTimecode(exportList.value.reduce((n, i) => n + i.clip.endMs - i.clip.startMs, 0) / 1000))
const NuxtLink = resolveComponent('NuxtLink')
</script>

<template>
  <PageShell title="Clips">
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <UInput v-model="search" icon="i-lucide-search" placeholder="Search clips" class="w-full sm:w-64" />
        <USelect v-model="project" :items="projectItems" value-key="value" class="w-full sm:w-64" />
        <USwitch v-model="hideUploaded" :label="`Hide uploaded${uploadedCount ? ` (${uploadedCount})` : ''}`" />
        <span class="ml-auto text-sm text-muted">{{ shown.length }} of {{ items.length }}</span>
      </div>

      <!-- Exporting: pick clips, or take every shown clip that needs it -->
      <div v-if="items.length" class="flex flex-wrap items-center gap-2">
        <template v-if="!selecting">
          <UButton label="Select" icon="i-lucide-square-check" color="neutral" variant="outline" size="sm" @click="selecting = true" />
          <UButton
            :label="allToExport.length ? `Export all (${allToExport.length})` : 'Everything shown is exported'"
            icon="i-lucide-film"
            size="sm"
            :disabled="!allToExport.length"
            @click="askExport(allToExport)"
          />
        </template>
        <template v-else>
          <span class="text-sm font-medium">{{ selected.length }} selected</span>
          <UButton label="Select all shown" color="neutral" variant="ghost" size="sm" @click="selected = shown.map((i) => i.clip.id)" />
          <UButton v-if="selected.length" label="Clear" color="neutral" variant="ghost" size="sm" @click="selected = []" />
          <UButton
            :label="`Export ${selected.length || ''}`.trim()"
            icon="i-lucide-film"
            size="sm"
            :disabled="!selected.length"
            @click="askExport(items.filter((i) => selected.includes(i.clip.id)))"
          />
          <UButton label="Done" color="neutral" variant="outline" size="sm" @click="stopSelecting" />
        </template>
      </div>

      <UEmpty
        v-if="!items.length"
        icon="i-lucide-clapperboard"
        title="No clips yet"
        description="Clips you make or approve in any project show up here."
        :actions="[{ label: 'Go to Projects', to: '/' }]"
        variant="naked"
      />
      <UEmpty
        v-else-if="!shown.length"
        icon="i-lucide-filter"
        title="Nothing matches"
        :description="hideUploaded && uploadedCount ? 'Every matching clip is already uploaded. Turn off “Hide uploaded” to see them.' : 'Try another search or project.'"
        variant="naked"
      />

      <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <component
          :is="selecting ? 'button' : NuxtLink"
          v-for="i in shown"
          :key="i.clip.id"
          v-bind="selecting ? { type: 'button', 'aria-pressed': selected.includes(i.clip.id) } : { to: `/clips/${i.clip.id}?from=clips` }"
          class="group overflow-hidden rounded-lg border text-left transition hover:border-accented"
          :class="selecting && selected.includes(i.clip.id) ? 'border-primary ring-2 ring-primary/40' : 'border-default'"
          @click="selecting && toggle(i.clip.id)"
        >
          <div class="relative">
            <img :src="`/api/projects/${i.clip.projectId}/frame?t=${i.clip.startMs + 400}&w=320`" alt="" class="aspect-video w-full object-cover" loading="lazy" />
            <span class="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 text-xs text-white tabular-nums">{{ length(i) }}</span>
            <UBadge
              v-if="i.clip.evaluation"
              :label="`${i.clip.evaluation.total.toFixed(1)}`"
              :icon="verdict(i.clip.evaluation.total).icon"
              :color="evaluationState(i.clip.evaluation, i.clip) === 'stale' ? 'neutral' : verdict(i.clip.evaluation.total).tone"
              variant="solid"
              size="sm"
              class="absolute top-1.5 left-1.5"
            />
            <span
              v-if="selecting"
              class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md border-2"
              :class="selected.includes(i.clip.id) ? 'border-primary bg-primary text-inverted' : 'border-white/80 bg-black/40'"
            >
              <UIcon v-if="selected.includes(i.clip.id)" name="i-lucide-check" class="size-4" />
            </span>
            <span v-else class="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
              <UIcon name="i-lucide-pencil" class="size-5 text-white" />
            </span>
          </div>
          <div class="space-y-1 p-2">
            <p class="truncate text-sm font-medium">{{ i.clip.title }}</p>
            <p class="truncate text-xs text-muted">{{ i.projectName }}</p>
            <div class="flex flex-wrap gap-1">
              <UBadge v-if="i.uploaded" :label="`Uploaded${i.uploaded > 1 ? ` ×${i.uploaded}` : ''}`" icon="i-lucide-check" color="success" variant="subtle" size="sm" />
              <UBadge v-else-if="i.waiting" label="Waiting to post" icon="i-lucide-clock" color="primary" variant="subtle" size="sm" />
              <UBadge :label="exportState(i).label" :color="exportState(i).color" variant="subtle" size="sm" />
            </div>
          </div>
        </component>
      </div>
    </div>

    <UModal
      v-model:open="confirmOpen"
      :title="exportList.length ? `Export ${exportList.length} ${exportList.length === 1 ? 'clip' : 'clips'}?` : 'Nothing to export'"
      :description="exportList.length ? 'Each becomes a vertical 1080×1920 MP4 with its own captions, hook and layout. They\'re made one at a time on this Mac.' : 'Every chosen clip already has an up-to-date export.'"
    >
      <template #body>
        <ul v-if="exportList.length" class="max-h-72 space-y-1 overflow-y-auto text-sm">
          <li v-for="i in exportList" :key="i.clip.id" class="flex justify-between gap-4">
            <span class="truncate">{{ i.clip.title }} <span class="text-muted">· {{ i.projectName }}</span></span>
            <span class="shrink-0 text-muted tabular-nums">{{ length(i) }}</span>
          </li>
        </ul>
        <p v-if="exportList.length" class="mt-3 text-xs text-muted">{{ totalLength }} of video in total.</p>
        <p v-if="exportSkipped" class="mt-2 text-xs text-muted">
          {{ exportSkipped }} {{ exportSkipped === 1 ? 'clip is' : 'clips are' }} skipped: already exported and unchanged, or exporting now.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="confirmOpen = false" />
          <UButton
            v-if="exportList.length"
            :label="`Export ${exportList.length} ${exportList.length === 1 ? 'clip' : 'clips'}`"
            icon="i-lucide-film"
            :loading="exporting"
            @click="runExport"
          />
        </div>
      </template>
    </UModal>
  </PageShell>
</template>
