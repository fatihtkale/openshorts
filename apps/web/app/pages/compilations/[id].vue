<script setup lang="ts">
import {
  chaptersValid,
  chapterTime,
  clipScore,
  verdict,
  creditLine,
  CREDIT_PLATFORM_LABELS,
  CREDIT_PLATFORMS,
  formatTimecode,
  suggestCompilationText,
  youtubeChapters,
  type CompilationDetail,
  type CompilationItem,
  type Credit,
  type LibraryClip,
} from '@clipstudio/core/shared'

/**
 * One compilation: pick clips, put them in order, check each streamer's credit (shown as a banner for the first
 * seconds of their clip), export it as one landscape video, then post or schedule it like any other export.
 */
const route = useRoute()
const toast = useToast()
const id = computed(() => String(route.params.id))
const { data, refresh, error } = await useFetch<CompilationDetail>(() => `/api/compilations/${id.value}`, { server: false, deep: true })
const { jobs } = useJobs()
onJobStatusChange((job) => {
  if (job.type === 'compilation.render' && job.subjectId === id.value) void refresh()
})

const errorText = (e: unknown) => (e as { statusMessage?: string }).statusMessage ?? (e as Error).message
const saving = ref(false)
/** Saves a change and takes the server's copy (with the new version). */
async function save(patch: { title?: string; items?: CompilationItem[] }) {
  if (!data.value) return
  saving.value = true
  try {
    data.value = await $fetch<CompilationDetail>(`/api/compilations/${id.value}`, { method: 'PATCH', body: { version: data.value.version, ...patch } })
  } catch (e) {
    toast.add({ title: 'Not saved', description: errorText(e), color: 'error' })
    await refresh()
  } finally {
    saving.value = false
  }
}

// ── Title ──────────────────────────────────────────────────────────
const titleDraft = ref('')
watch(
  () => data.value?.title,
  (t) => (titleDraft.value = t ?? ''),
  { immediate: true },
)
function saveTitle() {
  const t = titleDraft.value.trim()
  if (t && t !== data.value?.title) void save({ title: t })
}

// ── Clips ──────────────────────────────────────────────────────────
const items = computed(() => data.value?.items ?? [])
const info = (clipId: string) => data.value?.clips[clipId]
const lengthMs = (clipId: string) => {
  const c = info(clipId)
  return c ? c.endMs - c.startMs : 0
}
const totalMs = computed(() => items.value.reduce((n, i) => n + lengthMs(i.clipId), 0))
const frameUrl = (clipId: string) => {
  const c = info(clipId)
  return c && !c.missing && c.projectId ? `/api/projects/${c.projectId}/frame?t=${c.startMs + 400}&w=640` : null
}
const selected = ref<string | null>(null)
watch(items, (list) => {
  if (!list.find((i) => i.clipId === selected.value)) selected.value = list[0]?.clipId ?? null
}, { immediate: true })
const selectedItem = computed(() => items.value.find((i) => i.clipId === selected.value) ?? null)

function move(index: number, by: -1 | 1) {
  const list = [...items.value]
  const to = index + by
  if (to < 0 || to >= list.length) return
  ;[list[index], list[to]] = [list[to]!, list[index]!]
  void save({ items: list })
}
function remove(clipId: string) {
  void save({ items: items.value.filter((i) => i.clipId !== clipId) })
}
/** Credit fields save when you leave them (or pick a platform). */
function setCredit(clipId: string, patch: Partial<Credit>) {
  void save({ items: items.value.map((i) => (i.clipId === clipId ? { ...i, credit: { ...i.credit, ...patch } } : i)) })
}
/** Same streamer elsewhere in the list: copy this credit to all of their clips. */
function creditKey(c: Credit) {
  return `${c.platform}:${(c.handle || c.name).toLowerCase()}`
}
const platformItems = CREDIT_PLATFORMS.map((p) => ({ label: CREDIT_PLATFORM_LABELS[p], value: p }))

// ── Adding clips ───────────────────────────────────────────────────
const addOpen = ref(false)
const { data: library, refresh: refreshLibrary } = await useFetch<LibraryClip[]>('/api/clips', { default: () => [], server: false, immediate: false })
const search = ref('')
const uploadedOnly = ref(true)
const sortBy = ref<'score' | 'newest'>('score')
const sortItems = [
  { label: 'Best score first', value: 'score' },
  { label: 'Newest first', value: 'newest' },
]
const picked = ref<string[]>([])
async function openAdd() {
  picked.value = []
  addOpen.value = true
  await refreshLibrary()
}
const choices = computed(() => {
  const have = new Set(items.value.map((i) => i.clipId))
  const q = search.value.trim().toLowerCase()
  const list = library.value.filter(
    (i) =>
      !have.has(i.clip.id) &&
      (!uploadedOnly.value || i.uploaded > 0 || i.waiting > 0) &&
      (!q || i.clip.title.toLowerCase().includes(q) || i.projectName.toLowerCase().includes(q)),
  )
  // The library comes newest first; unscored clips go last when sorting by score.
  return sortBy.value === 'score' ? [...list].sort((a, b) => (clipScore(b.clip) ?? -1) - (clipScore(a.clip) ?? -1)) : list
})
function togglePick(clipId: string) {
  picked.value = picked.value.includes(clipId) ? picked.value.filter((x) => x !== clipId) : [...picked.value, clipId]
}
const adding = ref(false)
async function addPicked() {
  if (!data.value || !picked.value.length) return
  adding.value = true
  try {
    data.value = await $fetch<CompilationDetail>(`/api/compilations/${id.value}/clips`, { method: 'POST', body: { version: data.value.version, clipIds: picked.value } })
    addOpen.value = false
  } catch (e) {
    toast.add({ title: 'Could not add them', description: errorText(e), color: 'error' })
  } finally {
    adding.value = false
  }
}

// ── Export ─────────────────────────────────────────────────────────
const exportJob = computed(() => jobs.value.find((j) => j.type === 'compilation.render' && j.subjectId === id.value && (j.status === 'queued' || j.status === 'running')))
const busy = computed(() => !!exportJob.value || data.value?.status === 'queued' || data.value?.status === 'running')
const upToDate = computed(() => data.value?.status === 'done' && data.value.renderedVersion === data.value.version)
const missingCount = computed(() => items.value.filter((i) => info(i.clipId)?.missing).length)
const noCredit = computed(() => items.value.filter((i) => !i.credit.name.trim() && !i.credit.handle.trim()).length)
const exportOpen = ref(false)
const starting = ref(false)
async function startExport() {
  starting.value = true
  try {
    await $fetch(`/api/compilations/${id.value}/render`, { method: 'POST' })
    exportOpen.value = false
    toast.add({ title: 'Export started', description: 'Each clip is rendered, then they are joined. Follow it in Activity.', icon: 'i-lucide-film' })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not start the export', description: errorText(e), color: 'error' })
  } finally {
    starting.value = false
  }
}

// ── Result, posting ────────────────────────────────────────────────
const videoUrl = computed(() => (data.value?.render?.status === 'done' ? `/api/renders/${data.value.render.id}/download?inline=1` : null))
const downloadUrl = computed(() => (data.value?.render?.status === 'done' ? `/api/renders/${data.value.render.id}/download` : null))
const suggestion = computed(() => (data.value ? suggestCompilationText(data.value.title, data.value.chapters, data.value.durationMs ?? 0) : undefined))
const chaptersOk = computed(() => !!data.value && chaptersValid(youtubeChapters(data.value.chapters, data.value.durationMs ?? 0), data.value.durationMs ?? 0))
const postOpen = ref(false)

// ── Delete ─────────────────────────────────────────────────────────
const deleteOpen = ref(false)
async function deleteIt() {
  try {
    await $fetch(`/api/compilations/${id.value}`, { method: 'DELETE' })
    await navigateTo('/compilations')
  } catch (e) {
    toast.add({ title: 'Could not delete it', description: errorText(e), color: 'error' })
  }
}
</script>

<template>
  <PageShell :title="data?.title ?? 'Compilation'">
    <template #actions>
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/compilations" aria-label="Back to compilations" />
    </template>

    <UAlert v-if="error" color="error" variant="subtle" title="This compilation could not be loaded" :description="errorText(error)" />

    <div v-else-if="data" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <!-- Left: title and the clips, in order -->
      <div class="min-w-0 space-y-4">
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Title" class="min-w-64 flex-1">
            <UInput v-model="titleDraft" class="w-full" maxlength="100" @blur="saveTitle" @keydown.enter="saveTitle" />
          </UFormField>
          <UButton label="Add clips" icon="i-lucide-plus" color="neutral" variant="outline" @click="openAdd" />
        </div>

        <p class="text-sm text-muted">
          {{ items.length }} {{ items.length === 1 ? 'clip' : 'clips' }} · about {{ formatTimecode(totalMs / 1000) }}
          <span v-if="saving"> · Saving…</span>
        </p>

        <UEmpty
          v-if="!items.length"
          icon="i-lucide-clapperboard"
          title="No clips yet"
          description="Add clips from your library. Uploaded ones are shown first; they're the ones you already know work."
          :actions="[{ label: 'Add clips', icon: 'i-lucide-plus', onClick: openAdd }]"
          variant="naked"
        />

        <ol class="space-y-2">
          <li
            v-for="(item, index) in items"
            :key="item.clipId"
            class="flex gap-3 rounded-lg border p-2 transition"
            :class="selected === item.clipId ? 'border-primary bg-elevated/40' : 'border-default'"
            @click="selected = item.clipId"
          >
            <div class="flex flex-col items-center justify-between">
              <span class="text-xs text-muted tabular-nums">{{ index + 1 }}</span>
              <div class="flex flex-col">
                <UButton icon="i-lucide-chevron-up" size="xs" color="neutral" variant="ghost" :disabled="index === 0 || saving" aria-label="Move up" @click.stop="move(index, -1)" />
                <UButton icon="i-lucide-chevron-down" size="xs" color="neutral" variant="ghost" :disabled="index === items.length - 1 || saving" aria-label="Move down" @click.stop="move(index, 1)" />
              </div>
            </div>
            <img v-if="frameUrl(item.clipId)" :src="frameUrl(item.clipId)!" alt="" class="aspect-video w-36 shrink-0 rounded object-cover" loading="lazy" />
            <div v-else class="grid aspect-video w-36 shrink-0 place-items-center rounded bg-elevated text-xs text-muted">Missing</div>
            <div class="min-w-0 flex-1 space-y-2">
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{{ info(item.clipId)?.title }}</p>
                  <p class="truncate text-xs text-muted">
                    {{ info(item.clipId)?.projectName }} · {{ formatTimecode(lengthMs(item.clipId) / 1000) }}
                  </p>
                </div>
                <UBadge
                  v-if="info(item.clipId)?.score != null"
                  :label="info(item.clipId)!.score!.toFixed(1)"
                  :icon="verdict(info(item.clipId)!.score!).icon"
                  :color="verdict(info(item.clipId)!.score!).tone"
                  variant="subtle"
                  size="sm"
                />
                <UBadge v-if="info(item.clipId)?.missing" label="No longer available" color="error" variant="subtle" size="sm" />
                <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="Remove from compilation" @click.stop="remove(item.clipId)" />
              </div>
              <div class="flex flex-wrap gap-2" @click.stop>
                <USelect
                  :model-value="item.credit.platform"
                  :items="platformItems"
                  value-key="value"
                  size="sm"
                  class="w-28"
                  @update:model-value="(v) => setCredit(item.clipId, { platform: v as Credit['platform'] })"
                />
                <UInput :model-value="item.credit.name" size="sm" placeholder="Name shown" class="w-36" @change="(e: Event) => setCredit(item.clipId, { name: (e.target as HTMLInputElement).value })" />
                <UInput
                  :model-value="item.credit.handle"
                  size="sm"
                  placeholder="Channel (for the link)"
                  class="w-40"
                  @change="(e: Event) => setCredit(item.clipId, { handle: (e.target as HTMLInputElement).value })"
                />
                <span v-if="creditLine(item.credit)" class="self-center text-xs text-muted">{{ creditLine(item.credit) }}</span>
              </div>
            </div>
          </li>
        </ol>
      </div>

      <!-- Right: banner preview, export, the finished video -->
      <div class="space-y-5">
        <div v-if="selectedItem" class="space-y-2">
          <p class="text-sm font-medium">Shoutout banner</p>
          <CompilationsCreditPreview :credit="selectedItem.credit" :frame-url="frameUrl(selectedItem.clipId)" />
          <p class="text-xs text-muted">
            Slides in for the first 4 seconds of the clip. Edit the name and channel next to the clip; the link also goes in the
            video's description.
          </p>
        </div>

        <div class="space-y-3 rounded-lg border border-default p-4">
          <div class="flex items-center justify-between gap-3">
            <p class="font-medium">Export</p>
            <UBadge v-if="busy" :label="exportJob?.status === 'running' ? `Exporting ${Math.round((exportJob.progress ?? 0) * 100)}%` : 'Waiting to export'" color="primary" variant="subtle" size="sm" />
            <UBadge v-else-if="upToDate" label="Up to date" color="success" variant="subtle" size="sm" />
            <UBadge v-else-if="data.status === 'done'" label="Edited since export" color="warning" variant="subtle" size="sm" />
            <UBadge v-else-if="data.status === 'failed'" label="Export failed" color="error" variant="subtle" size="sm" />
          </div>
          <p v-if="exportJob?.message" class="text-xs text-muted">{{ exportJob.message }}</p>
          <p v-if="data.status === 'failed' && data.error" class="text-xs text-error">{{ data.error }}</p>
          <p class="text-xs text-muted">One 1920×1080 video: every clip with its trims, loudness evened out, a short fade between clips and each streamer's banner.</p>
          <UButton
            :label="upToDate ? 'Export again' : 'Export'"
            icon="i-lucide-film"
            block
            :disabled="!items.length || busy || missingCount > 0"
            @click="exportOpen = true"
          />
          <p v-if="missingCount" class="text-xs text-error">Remove the clips that are no longer available first.</p>
        </div>

        <div v-if="videoUrl" class="space-y-3 rounded-lg border border-default p-4">
          <div class="flex items-center justify-between gap-3">
            <p class="font-medium">Finished video</p>
            <span class="text-xs text-muted tabular-nums">{{ formatTimecode((data.durationMs ?? 0) / 1000) }}</span>
          </div>
          <video :src="videoUrl" controls preload="metadata" class="aspect-video w-full rounded bg-black" />
          <div class="flex flex-wrap gap-2">
            <UButton label="Post or schedule" icon="i-lucide-send" :disabled="!upToDate" @click="postOpen = true" />
            <UButton label="Download" icon="i-lucide-download" color="neutral" variant="outline" :to="downloadUrl!" external />
            <UButton v-if="data.projectId" label="Open as project" icon="i-lucide-folder-open" color="neutral" variant="ghost" :to="`/projects/${data.projectId}`" />
          </div>
          <p v-if="!upToDate" class="text-xs text-warning">You changed the compilation since this export. Export again before posting.</p>
          <p class="text-xs text-muted">
            "Post or schedule" fills in chapters and every streamer's link. To schedule it in a calendar slot, export it here and pick it on the
            Schedule page. "Open as project" lets you cut Shorts from it.
          </p>
          <details v-if="data.chapters.length" class="text-xs">
            <summary class="cursor-pointer text-muted">Chapters{{ chaptersOk ? ' (clips under 10 s join the chapter before)' : ' (YouTube needs 3+ chapters of 10 s or more; they are left out)' }}</summary>
            <ul class="mt-2 space-y-0.5">
              <li v-for="c in data.chapters" :key="c.atMs" class="flex gap-2">
                <span class="tabular-nums text-muted">{{ chapterTime(c.atMs) }}</span>
                <span class="truncate">{{ c.title }}</span>
              </li>
            </ul>
          </details>
        </div>

        <UButton label="Delete compilation" icon="i-lucide-trash-2" color="error" variant="ghost" size="sm" :disabled="busy" @click="deleteOpen = true" />
      </div>
    </div>

    <!-- Add clips -->
    <UModal v-model:open="addOpen" title="Add clips" description="Approved clips from every project. They're added at the end; reorder them after." :ui="{ content: 'max-w-3xl' }">
      <template #body>
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search clips" class="w-full sm:w-64" />
          <USwitch v-model="uploadedOnly" label="Uploaded or scheduled only" />
          <USelect v-model="sortBy" :items="sortItems" value-key="value" class="w-44" />
          <span class="ml-auto text-sm text-muted">{{ picked.length }} picked</span>
        </div>
        <p v-if="!choices.length" class="py-6 text-center text-sm text-muted">Nothing to add{{ uploadedOnly ? ' (try turning off "Uploaded or scheduled only")' : '' }}.</p>
        <div class="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          <button
            v-for="i in choices"
            :key="i.clip.id"
            type="button"
            class="overflow-hidden rounded-lg border text-left transition"
            :class="picked.includes(i.clip.id) ? 'border-primary ring-2 ring-primary/40' : 'border-default hover:border-accented'"
            :aria-pressed="picked.includes(i.clip.id)"
            @click="togglePick(i.clip.id)"
          >
            <div class="relative">
              <img :src="`/api/projects/${i.clip.projectId}/frame?t=${i.clip.startMs + 400}&w=320`" alt="" class="aspect-video w-full object-cover" loading="lazy" />
              <UBadge
                v-if="clipScore(i.clip) !== null"
                :label="clipScore(i.clip)!.toFixed(1)"
                :icon="verdict(clipScore(i.clip)!).icon"
                :color="verdict(clipScore(i.clip)!).tone"
                variant="solid"
                size="sm"
                class="absolute top-1.5 left-1.5"
              />
              <UBadge v-else label="No score" color="neutral" variant="solid" size="sm" class="absolute top-1.5 left-1.5 opacity-80" />
              <span
                v-if="picked.includes(i.clip.id)"
                class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md bg-primary text-inverted"
              >
                <UIcon name="i-lucide-check" class="size-4" />
              </span>
            </div>
            <div class="space-y-0.5 p-2">
              <p class="truncate text-sm font-medium">{{ i.clip.title }}</p>
              <p class="truncate text-xs text-muted">{{ i.projectName }} · {{ formatTimecode((i.clip.endMs - i.clip.startMs) / 1000) }}</p>
            </div>
          </button>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="addOpen = false" />
          <UButton :label="picked.length ? `Add ${picked.length}` : 'Add'" :disabled="!picked.length" :loading="adding" @click="addPicked" />
        </div>
      </template>
    </UModal>

    <!-- Export confirm -->
    <UModal v-model:open="exportOpen" :title="`Export ${items.length} clips as one video?`" description="It's made on this Mac, one clip at a time, then joined.">
      <template #body>
        <ul class="space-y-1 text-sm">
          <li>About {{ formatTimecode(totalMs / 1000) }} long, 1920×1080</li>
          <li>A shoutout banner for each clip ({{ new Set(items.map((i) => creditKey(i.credit))).size }} streamers)</li>
          <li v-if="noCredit" class="text-warning">{{ noCredit }} {{ noCredit === 1 ? 'clip has' : 'clips have' }} no name or channel, so no banner</li>
        </ul>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="exportOpen = false" />
          <UButton label="Export" icon="i-lucide-film" :loading="starting" @click="startExport" />
        </div>
      </template>
    </UModal>

    <!-- Delete confirm -->
    <UModal v-model:open="deleteOpen" title="Delete this compilation?" description="The clips themselves stay. A finished video stays as a project; delete that from Projects if you want it gone.">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="deleteOpen = false" />
          <UButton label="Delete" color="error" @click="deleteIt" />
        </div>
      </template>
    </UModal>

    <EditorPostModal
      v-if="data?.clip && data.render?.status === 'done'"
      v-model:open="postOpen"
      :clip="data.clip"
      :render="data.render"
      :suggestion="suggestion"
      @posted="refresh()"
    />
  </PageShell>
</template>
