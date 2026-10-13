<script setup lang="ts">
import type { ProjectDto } from '@clipstudio/core/shared'

const route = useRoute()
const id = computed(() => String(route.params.id))
const toast = useToast()

const { data: project, refresh, error } = await useFetch<ProjectDto>(() => `/api/projects/${id.value}`)

onJobStatusChange((job) => {
  if (job.projectId === id.value) void refresh()
})

const { activeFor, cancel } = useJobs()
const { uploads, cancel: cancelUpload } = useUploads()
const job = computed(() => activeFor(id.value))
const upload = computed(() => uploads.value[id.value])
const activity = computed(() => (project.value ? describeProject(project.value, job.value, upload.value) : null))
watch(
  () => !!upload.value,
  (now, before) => {
    if (before && !now) void refresh()
  },
)

const action = ref<'rename' | 'trash' | null>(null)
function onChanged(updated: ProjectDto) {
  if (updated.deletedAt) navigateTo('/')
  else project.value = updated
}

const retrying = ref(false)
async function retry() {
  retrying.value = true
  try {
    project.value = await $fetch<ProjectDto>(`/api/projects/${id.value}/retry`, { method: 'POST' })
  } catch (e) {
    toast.add({ title: 'Could not retry', description: (e as Error).message, color: 'error' })
  } finally {
    retrying.value = false
  }
}

async function stop() {
  try {
    if (upload.value) cancelUpload(id.value)
    else if (job.value) await cancel(job.value.id)
  } catch (e) {
    toast.add({ title: 'Could not stop', description: (e as Error).message, color: 'error' })
  }
}

// Playback position for the transcript: timeupdate fires ~4×/s, so a frame loop keeps the highlight smooth while playing.
const video = ref<HTMLVideoElement>()
const currentMs = ref(0)
let frame = 0
function syncTime() {
  if (video.value) currentMs.value = video.value.currentTime * 1000
}
function startTicking() {
  cancelAnimationFrame(frame)
  const tick = () => {
    syncTime()
    frame = requestAnimationFrame(tick)
  }
  tick()
}
function stopTicking() {
  cancelAnimationFrame(frame)
  syncTime()
}
onBeforeUnmount(() => cancelAnimationFrame(frame))
function seek(ms: number) {
  if (!video.value) return
  stopAtMs = null
  skips = []
  video.value.currentTime = ms / 1000
  syncTime()
}

// Playing a clip: start at its first word and pause at its end, jumping over any cut-out parts.
let stopAtMs: number | null = null
let skips: { start: number; end: number }[] = []
function playRange(startMs: number, endMs: number, cuts: { start: number; end: number }[] = []) {
  if (!video.value) return
  skips = [...cuts].sort((a, b) => a.start - b.start)
  const first = skips.find((c) => c.start <= startMs && c.end > startMs)
  video.value.currentTime = (first ? first.end : startMs) / 1000
  stopAtMs = endMs
  void video.value.play()
  video.value.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
watch(currentMs, (ms) => {
  if (stopAtMs === null) return
  const inCut = skips.find((c) => ms >= c.start && ms < c.end - 30)
  if (inCut && video.value) video.value.currentTime = inCut.end / 1000
  else if (ms >= stopAtMs) {
    stopAtMs = null
    skips = []
    video.value?.pause()
  }
})

const vertical = computed(() => !!project.value?.width && !!project.value.height && project.value.height > project.value.width)

const proxyUrl = computed(() =>
  project.value?.assets.proxy ? `/api/projects/${id.value}/media/proxy?v=${project.value.assets.proxy.updatedAt}` : null,
)

const details = computed(() => {
  const p = project.value
  if (!p) return []
  const rows: { label: string; value: string; href?: string }[] = [
    { label: 'Length', value: formatDuration(p.durationMs) },
    { label: 'Size', value: p.width && p.height ? `${p.width} × ${p.height}${p.height > p.width ? ' (vertical)' : ''}` : '' },
    { label: 'Frame rate', value: p.fps ? `${Math.round(p.fps * 100) / 100} fps` : '' },
    { label: 'Sound', value: p.hasAudio === null ? '' : p.hasAudio ? 'Yes' : 'No audio track' },
  ]
  if (p.sourceType === 'youtube' || p.sourceType === 'twitch') {
    const site = p.sourceType === 'twitch' ? (p.sourceMeta?.twitch?.kind === 'clip' ? 'Twitch clip' : 'Twitch VOD') : 'YouTube'
    rows.push({ label: 'Source', value: p.sourceMeta?.channel ? `${site} · ${p.sourceMeta.channel}` : site, href: p.sourceUrl ?? undefined })
  } else {
    rows.push({ label: 'Source', value: 'Uploaded file' })
  }
  rows.push({ label: 'Imported', value: new Date(p.createdAt).toLocaleString() })
  rows.push({ label: 'On disk', value: formatBytes(p.storageBytes) })
  return rows.filter((r) => r.value)
})
</script>

<template>
  <PageShell :title="project?.name ?? 'Project'">
    <template #actions>
      <template v-if="project">
        <UButton label="Rename" icon="i-lucide-pencil" color="neutral" variant="ghost" class="hidden sm:inline-flex" @click="action = 'rename'" />
        <UButton label="Move to Trash" icon="i-lucide-trash-2" color="neutral" variant="ghost" class="hidden sm:inline-flex" @click="action = 'trash'" />
      </template>
    </template>

    <UEmpty
      v-if="error"
      icon="i-lucide-search-x"
      title="Project not found"
      description="It may have been deleted for good."
      :actions="[{ label: 'Back to Projects', to: '/' }]"
      class="py-16"
    />

    <div v-else-if="project && activity" class="mx-auto w-full max-w-6xl space-y-6">
      <UBreadcrumb :items="[{ label: 'Projects', to: '/' }, { label: project.name }]" />

      <!-- Still importing, or failed -->
      <UCard v-if="project.status !== 'ready'">
        <div class="flex flex-col gap-6 sm:flex-row">
          <img
            v-if="thumbnailUrl(project)"
            :src="thumbnailUrl(project)!"
            alt=""
            class="aspect-video w-full rounded-md object-cover sm:w-72"
            :class="{ 'opacity-60': activity.busy }"
          />
          <div class="flex min-w-0 flex-1 flex-col justify-center gap-3">
            <div class="flex items-center gap-2">
              <UIcon
                :name="activity.busy ? 'i-lucide-loader-circle' : activity.tone === 'error' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'"
                class="size-5"
                :class="{ 'animate-spin text-primary': activity.busy, 'text-error': activity.tone === 'error', 'text-warning': activity.tone === 'warning' }"
              />
              <p class="font-medium">{{ activity.label }}</p>
            </div>
            <UProgress v-if="activity.busy" :model-value="activity.progress === null ? null : Math.round(activity.progress * 100)" />
            <p v-if="activity.detail" class="text-sm" :class="activity.tone === 'error' ? 'text-error' : 'text-muted'">{{ activity.detail }}</p>
            <div class="flex gap-2">
              <ConfirmButton v-if="activity.busy" label="Stop" confirm-label="Stop importing?" icon="i-lucide-square" size="sm" @confirm="stop" />
              <UButton v-if="project.status === 'failed'" label="Try again" icon="i-lucide-rotate-ccw" size="sm" :loading="retrying" @click="retry" />
              <UButton
                v-if="!activity.busy"
                label="Move to Trash"
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="action = 'trash'"
              />
            </div>
          </div>
        </div>
      </UCard>

      <!-- Ready -->
      <div v-else class="grid gap-6 lg:grid-cols-5">
        <div class="space-y-6 lg:col-span-3">
          <div class="overflow-hidden rounded-lg bg-black">
            <video
              v-if="proxyUrl"
              ref="video"
              :key="proxyUrl"
              :src="proxyUrl"
              :poster="thumbnailUrl(project) ?? undefined"
              controls
              preload="metadata"
              class="mx-auto"
              :class="vertical ? 'aspect-[9/16] max-h-[70vh]' : 'aspect-video w-full'"
              @timeupdate="syncTime"
              @seeked="syncTime"
              @play="startTicking"
              @pause="stopTicking"
            />
          </div>
          <HighlightsPanel v-if="project.status === 'ready'" :project="project" @play="playRange" />
          <ProjectClips :project="project" @play="playRange" />
          <UCard>
            <dl class="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <div v-for="row in details" :key="row.label" class="flex justify-between gap-4">
                <dt class="text-muted">{{ row.label }}</dt>
                <dd class="truncate text-right">
                  <ULink v-if="row.href" :to="row.href" target="_blank" class="inline-flex items-center gap-1">
                    {{ row.value }} <UIcon name="i-lucide-external-link" class="size-3" />
                  </ULink>
                  <template v-else>{{ row.value }}</template>
                </dd>
              </div>
            </dl>
          </UCard>
        </div>
        <div class="lg:col-span-2">
          <div class="lg:sticky lg:top-0 lg:h-[calc(100dvh-8rem)]">
            <TranscriptPanel :project="project" :current-ms="currentMs" class="h-[70vh] lg:h-full" @seek="seek" @changed="refresh()" />
          </div>
        </div>
      </div>
    </div>

    <ProjectActionModals v-model:action="action" :project="project ?? null" @changed="onChanged" />
  </PageShell>
</template>
