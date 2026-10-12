<script setup lang="ts">
import {
  formatTimecode,
  parseTimecode,
  type DownloadQuality,
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
}

const loading = ref(false)
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
const canSubmit = computed(() => valid.value.length > 0 && valid.value.every((i) => !rangeError(i) && i.name.trim()))

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
        items: valid.value.map((i) => ({
          url: i.preview.url,
          name: i.name.trim(),
          meta: i.preview.meta,
          quality: i.quality,
          range: i.partial ? { start: parseTimecode(i.start), end: parseTimecode(i.end) } : undefined,
        })),
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
    title="Import from YouTube"
    description="Check what will be downloaded. Nothing starts until you confirm."
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div v-if="loading" class="space-y-4">
        <p class="text-sm text-muted">Checking {{ links.length === 1 ? 'the link' : `${links.length} links` }} with YouTube…</p>
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
            <img :src="item.preview.meta.thumbnailUrl" alt="" class="aspect-video w-full shrink-0 self-start rounded-md object-cover sm:w-40" />
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
                <USwitch v-model="item.partial" label="Only part of the video" />
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
        <p class="flex-1 text-xs text-muted">Only download videos you own or have permission to use.</p>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton
            :label="valid.length > 1 ? `Download ${valid.length} videos` : 'Download video'"
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
