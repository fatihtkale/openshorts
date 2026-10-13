<script setup lang="ts">
import {
  CLAUDE_MODELS,
  estimateEvaluateCost,
  formatTimecode,
  parseTimecode,
  type AiSettingsDto,
  type DownloadQuality,
  type VodMoment,
  type ProjectDto,
  type YoutubePreview,
} from '@clipstudio/core/shared'

const props = defineProps<{ links: string[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [projects: ProjectDto[]] }>()
const toast = useToast()

interface Item {
  preview: YoutubePreview
  name: string
  quality: DownloadQuality
  partial: boolean
  start: string
  end: string
  /** Smart import (Twitch VODs): download only these moments, one project each. */
  moments: VodMoment[] | null
  picked: number[]
  findingMoments: boolean
  momentsError: string | null
}

const loading = ref(false)
// Twitch clips can be scored as soon as they're ready, if in-app AI is set up.
const { data: ai } = await useFetch<AiSettingsDto>('/api/settings/ai', { server: false })
const aiUsable = computed(() => !!ai.value && ai.value.provider !== 'off' && (ai.value.provider !== 'anthropic' || ai.value.hasAnthropicKey || ai.value.envKey))
const autoEvaluate = ref(true)
const items = ref<Item[]>([])
const submitting = ref(false)

const qualityItems = [
  { label: '1080p (recommended)', value: '1080' },
  { label: '720p (smaller file)', value: '720' },
  { label: 'Best available (up to 4K)', value: 'best' },
]

watch(
  () => [open.value, props.links] as const,
  async ([isOpen, links]) => {
    if (!isOpen || !links.length) return
    loading.value = true
    items.value = []
    try {
      const previews = await $fetch<YoutubePreview[]>('/api/projects/youtube/preview', {
        method: 'POST',
        body: { links },
      })
      items.value = previews.map((preview) => ({
        preview,
        name: preview.meta?.title ?? '',
        quality: '1080',
        partial: false,
        start: '0:00',
        end: preview.meta?.durationSec ? formatTimecode(preview.meta.durationSec) : '',
        moments: null,
        picked: [],
        findingMoments: false,
        momentsError: null,
      }))
    } catch (error) {
      toast.add({ title: 'Could not check the links', description: (error as Error).message, color: 'error' })
      open.value = false
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

function rangeError(item: Item): string | null {
  if (!item.partial) return null
  const start = parseTimecode(item.start)
  const end = parseTimecode(item.end)
  if (start === null || end === null) return 'Use times like 1:30 or 1:02:30'
  if (end <= start) return 'The end must be after the start'
  const duration = item.preview.meta?.durationSec
  if (duration && end > duration + 1) return `The video is only ${formatTimecode(duration)} long`
  return null
}

const valid = computed(() => items.value.filter((i) => i.preview.meta && !i.preview.error))

async function findMoments(item: Item) {
  item.findingMoments = true
  item.momentsError = null
  try {
    const result = await $fetch<{ moments: VodMoment[]; clips: number }>('/api/projects/twitch/moments', { method: 'POST', body: { url: item.preview.url } })
    item.moments = result.moments
    item.picked = result.moments.slice(0, 8).map((_, i) => i)
    if (!result.moments.length) item.momentsError = 'Nobody has clipped this VOD yet, so there are no moments to pick. Import it whole or a part of it.'
  } catch (e) {
    item.momentsError = (e as { statusMessage?: string }).statusMessage ?? (e as Error).message
  } finally {
    item.findingMoments = false
  }
}
/** One project to create, as the import route takes it. */
interface ImportBody {
  url: string | null
  name: string
  meta: Item['preview']['meta']
  quality: DownloadQuality
  range?: { start: number | null; end: number | null }
  autoEvaluate: boolean
}
const smart = (i: Item) => !!i.moments?.length && i.picked.length > 0
function toggleMoment(item: Item, index: number, on: boolean) {
  item.picked = on ? [...new Set([...item.picked, index])].sort((a, b) => a - b) : item.picked.filter((x) => x !== index)
}
/** How many projects (downloads) confirming will create. */
const downloads = computed(() => valid.value.reduce((n, i) => n + (smart(i) ? i.picked.length : 1), 0))
const isClip = (i: Item) => i.preview.meta?.twitch?.kind === 'clip'
const isVod = (i: Item) => i.preview.meta?.twitch?.kind === 'vod'
const clipCount = computed(() => valid.value.filter(isClip).length)
const scoreCost = computed(() =>
  ai.value?.provider === 'anthropic' ? estimateEvaluateCost(clipCount.value, ai.value.anthropicModel) : 0,
)
const scorer = computed(() =>
  ai.value?.provider === 'ollama' ? ai.value.ollamaModel || 'Ollama' : (CLAUDE_MODELS.find((m) => m.id === ai.value?.anthropicModel)?.label ?? 'Claude'),
)
/** Rough download size: Twitch and YouTube 1080p60 run about 6 Mbit/s, 720p about half. */
function sizeEstimate(i: Item): string | null {
  const meta = i.preview.meta
  if (!meta?.durationSec) return null
  const start = i.partial ? (parseTimecode(i.start) ?? 0) : 0
  const end = i.partial ? (parseTimecode(i.end) ?? meta.durationSec) : meta.durationSec
  const mbps = i.quality === '720' ? 3 : i.quality === 'best' ? 9 : 6
  const gb = (Math.max(0, end - start) * mbps) / 8 / 1000
  return gb < 1 ? `about ${Math.max(1, Math.round(gb * 1000))} MB` : `about ${gb.toFixed(gb < 10 ? 1 : 0)} GB`
}
const canSubmit = computed(
  () => valid.value.length > 0 && downloads.value <= 20 && valid.value.every((i) => (smart(i) || !rangeError(i)) && i.name.trim()),
)

function remove(item: Item) {
  items.value = items.value.filter((i) => i !== item)
  if (!items.value.length) open.value = false
}

async function confirm() {
  submitting.value = true
  try {
    const created = await $fetch<ProjectDto[]>('/api/projects/youtube', {
      method: 'POST',
      body: {
        items: valid.value.flatMap<ImportBody>((i) =>
          smart(i)
            ? i.picked.map((k) => ({
                url: i.preview.url,
                // Named after the moment's most-viewed viewer clip; the VOD name only when that clip has no title.
                name: (i.moments![k]!.title.trim() || `${i.name.trim()} · ${formatTimecode(i.moments![k]!.startSec + 60)}`).slice(0, 200),
                meta: i.preview.meta,
                quality: i.quality,
                range: { start: i.moments![k]!.startSec, end: i.moments![k]!.endSec },
                autoEvaluate: false,
              }))
            : [
                {
                  url: i.preview.url,
                  name: i.name.trim(),
                  meta: i.preview.meta,
                  quality: i.quality,
                  range: i.partial && !isClip(i) ? { start: parseTimecode(i.start), end: parseTimecode(i.end) } : undefined,
                  autoEvaluate: isClip(i) && aiUsable.value && autoEvaluate.value,
                },
              ],
        ),
      },
    })
    toast.add({
      title: created.length === 1 ? 'Download started' : `${created.length} downloads started`,
      description: 'Follow along on the project cards, or in Activity.',
      icon: 'i-lucide-download',
    })
    emit('created', created)
    open.value = false
  } catch (error) {
    toast.add({ title: 'Could not start the download', description: (error as Error).message, color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Import videos"
    description="Check what will be downloaded. Nothing starts until you confirm."
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div v-if="loading" class="space-y-4">
        <p class="text-sm text-muted">Checking {{ links.length === 1 ? 'the link' : `${links.length} links` }}…</p>
        <div v-for="n in links.length" :key="n" class="flex gap-4">
          <USkeleton class="aspect-video w-40 shrink-0 rounded-md" />
          <div class="flex-1 space-y-2">
            <USkeleton class="h-4 w-3/4" />
            <USkeleton class="h-3 w-1/3" />
          </div>
        </div>
      </div>

      <ul v-else class="divide-y divide-default">
        <li v-for="item in items" :key="item.preview.input" class="py-4 first:pt-0 last:pb-0">
          <!-- Link that can't be imported -->
          <div v-if="!item.preview.meta || item.preview.error" class="flex items-start gap-3">
            <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-5 shrink-0 text-error" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ item.preview.meta?.title ?? item.preview.input }}</p>
              <p class="text-sm text-error">{{ item.preview.error }}</p>
            </div>
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" aria-label="Remove" @click="remove(item)" />
          </div>

          <div v-else class="flex flex-col gap-4 sm:flex-row">
            <img
              v-if="item.preview.meta.thumbnailUrl"
              :src="item.preview.meta.thumbnailUrl"
              alt=""
              class="aspect-video w-full shrink-0 self-start rounded-md object-cover sm:w-40"
            />
            <div class="min-w-0 flex-1 space-y-3">
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <UInput v-model="item.name" aria-label="Project name" class="w-full" />
                  <p class="mt-1 text-xs text-muted">
                    {{ item.preview.meta.channel }}
                    <template v-if="item.preview.meta.durationSec"> · {{ formatTimecode(item.preview.meta.durationSec) }}</template>
                    <template v-if="item.preview.meta.maxHeight"> · up to {{ item.preview.meta.maxHeight }}p</template>
                  </p>
                </div>
                <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" aria-label="Remove" @click="remove(item)" />
              </div>

              <div class="flex flex-wrap gap-2">
                <UBadge
                  v-if="item.preview.meta.twitch"
                  :label="isClip(item) ? 'Twitch clip' : 'Twitch VOD'"
                  icon="i-simple-icons-twitch"
                  color="neutral"
                  variant="subtle"
                />
                <UBadge
                  v-if="item.preview.meta.twitch?.viewCount"
                  :label="`${item.preview.meta.twitch.viewCount.toLocaleString()} views`"
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="outline"
                />
                <UBadge
                  v-if="item.preview.meta.license?.toLowerCase().includes('creative commons')"
                  label="Creative Commons"
                  icon="i-lucide-badge-check"
                  color="success"
                  variant="subtle"
                />
                <UBadge
                  v-for="existing in item.preview.existing"
                  :key="existing.id"
                  :label="`Already imported as “${existing.name}”`"
                  icon="i-lucide-copy"
                  color="warning"
                  variant="subtle"
                />
              </div>

              <div class="flex flex-wrap items-center gap-3">
                <USelect v-model="item.quality" :items="qualityItems" value-key="value" class="w-56" aria-label="Quality" />
                <USwitch v-if="!isClip(item)" v-model="item.partial" label="Only part of the video" />
                <span v-if="sizeEstimate(item)" class="text-xs text-muted">{{ sizeEstimate(item) }}</span>
              </div>
              <p v-if="isVod(item) && !item.partial && !smart(item) && (item.preview.meta.durationSec ?? 0) > 3600" class="flex items-start gap-1.5 text-xs text-warning">
                <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
                A long stream: the whole VOD takes a while to download and transcribe. Use Smart import below, or “Only part of the video”.
              </p>

              <!-- Smart import: only the moments viewers clipped -->
              <div v-if="isVod(item)" class="space-y-2 rounded-md border border-default p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
                  <p class="flex-1 text-sm font-medium">Smart import</p>
                  <UButton
                    v-if="!item.moments"
                    label="Find the hot moments"
                    size="xs"
                    color="neutral"
                    variant="outline"
                    :loading="item.findingMoments"
                    @click="findMoments(item)"
                  />
                </div>
                <p v-if="!item.moments && !item.momentsError" class="text-xs text-muted">
                  Download only the moments viewers clipped on Twitch, each with a minute of build-up, instead of the whole stream.
                </p>
                <p v-if="item.momentsError" class="text-xs text-warning">{{ item.momentsError }}</p>
                <ul v-if="item.moments?.length" class="max-h-56 space-y-1 overflow-y-auto">
                  <li v-for="(m, k) in item.moments.slice(0, 20)" :key="k" class="flex items-center gap-2 text-sm">
                    <UCheckbox :model-value="item.picked.includes(k)" @update:model-value="toggleMoment(item, k, !!$event)" />
                    <span class="w-24 shrink-0 text-xs text-muted tabular-nums">{{ formatTimecode(m.startSec) }}–{{ formatTimecode(m.endSec) }}</span>
                    <span class="min-w-0 flex-1 truncate">{{ m.title }}</span>
                    <span class="shrink-0 text-xs text-muted tabular-nums">{{ m.clips }} clip{{ m.clips === 1 ? '' : 's' }} · {{ m.views.toLocaleString() }} views</span>
                  </li>
                </ul>
                <p v-if="smart(item)" class="text-xs text-muted">
                  {{ item.picked.length }} moment{{ item.picked.length === 1 ? '' : 's' }} become {{ item.picked.length === 1 ? 'a project' : 'separate projects' }}, about
                  {{ Math.round(item.picked.reduce((sum, k) => sum + item.moments![k]!.endSec - item.moments![k]!.startSec, 0) / 60) }} minutes in total,
                  each named after its most-viewed clip.
                </p>
              </div>

              <div v-if="item.partial" class="flex flex-wrap items-start gap-3">
                <UFormField label="From" size="sm">
                  <UInput v-model="item.start" placeholder="0:00" class="w-28" />
                </UFormField>
                <UFormField label="To" size="sm" :error="rangeError(item) ?? undefined">
                  <UInput v-model="item.end" placeholder="10:00" class="w-28" />
                </UFormField>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
        <div class="flex-1 space-y-2">
          <USwitch
            v-if="clipCount && aiUsable"
            v-model="autoEvaluate"
            size="sm"
            :label="`Score ${clipCount === 1 ? 'the clip' : `the ${clipCount} clips`} with ${scorer} when ready`"
            :description="ai?.provider === 'anthropic' ? `About $${Math.max(0.01, scoreCost).toFixed(2)} in total on your API key` : 'Runs on this Mac'"
          />
          <p class="text-xs text-muted">Only download videos you own or have permission to use.</p>
        </div>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton
            :label="downloads > 1 ? `Download ${downloads} videos` : 'Download video'"
            icon="i-lucide-download"
            :loading="submitting"
            :disabled="loading || !canSubmit"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
