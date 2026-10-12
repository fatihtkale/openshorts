<script setup lang="ts">
import { presetById } from '@clipstudio/captions'
import { formatTimecode, type RenderDto } from '@clipstudio/core/shared'
import type { ClipEditor } from '~/composables/useClipEditor'

const props = defineProps<{ editor: ClipEditor }>()
const confirmOpen = defineModel<boolean>('confirmOpen', { default: false })
const toast = useToast()
const now = useNow()
const { jobs, cancel } = useJobs()

const data = computed(() => props.editor.data.value!)
const draft = computed(() => props.editor.draft.value!)
const renders = computed(() => data.value.renders)
const latest = computed(() => renders.value[0] ?? null)
const upToDate = computed(() => latest.value?.status === 'done' && latest.value.clipVersion === props.editor.version.value)

/** The live job behind a queued or running export. */
function jobFor(r: RenderDto) {
  return jobs.value.find((j) => j.subjectId === r.id && (j.status === 'queued' || j.status === 'running'))
}

onJobStatusChange((job) => {
  if (job.type === 'clip.render' && renders.value.some((r) => r.id === job.subjectId)) void props.editor.refresh()
})

const summary = computed(() => {
  const d = draft.value
  const layouts = { fill: 'Cropped to vertical', fit: 'Whole frame, blurred background', split: 'Split top and bottom' }
  return [
    { label: 'Length', value: formatTimecode(props.editor.duration.value / 1000) },
    { label: 'Picture', value: layouts[d.edit.layout.mode] + (d.edit.layout.mode === 'fill' && d.edit.layout.keyframes.length > 1 ? ', moving' : '') },
    { label: 'Captions', value: d.edit.captions.enabled ? presetById(d.edit.captions.preset).label : 'Off' },
    { label: 'Hook', value: d.edit.hook.enabled && d.edit.hook.text ? `“${d.edit.hook.text}”` : 'Off' },
    { label: 'File', value: 'MP4 · 1080×1920 · 30 fps' },
  ]
})

const starting = ref(false)
async function start() {
  starting.value = true
  try {
    await props.editor.save()
    await $fetch(`/api/clips/${data.value.clip.id}/render`, { method: 'POST' })
    confirmOpen.value = false
    toast.add({ title: 'Export started', description: 'It usually takes a few seconds per minute of video.', icon: 'i-lucide-film' })
    await props.editor.refresh()
  } catch (e) {
    toast.add({ title: 'Could not start the export', description: (e as Error).message, color: 'error' })
  } finally {
    starting.value = false
  }
}

const playing = ref<string | null>(null)
</script>

<template>
  <div class="space-y-5">
    <div class="rounded-lg border border-default p-4">
      <p class="font-medium">
        {{ upToDate ? 'Your latest export matches these edits.' : latest?.status === 'done' ? 'You changed the clip since the last export.' : 'Ready to export.' }}
      </p>
      <p class="mt-1 text-sm text-muted">A vertical MP4 you can post anywhere. It's made on this Mac.</p>
      <UButton :label="upToDate ? 'Export again' : 'Export video'" icon="i-lucide-film" class="mt-3" :color="upToDate ? 'neutral' : 'primary'" :variant="upToDate ? 'outline' : 'solid'" @click="confirmOpen = true" />
    </div>

    <div v-if="renders.length" class="space-y-2">
      <p class="text-sm font-medium">Exports</p>
      <ul class="divide-y divide-default rounded-lg border border-default">
        <li v-for="r in renders" :key="r.id" class="space-y-2 p-3">
          <div class="flex items-center gap-3">
            <UIcon
              :name="r.status === 'done' ? 'i-lucide-circle-check' : r.status === 'failed' ? 'i-lucide-circle-x' : 'i-lucide-loader-circle'"
              class="size-5 shrink-0"
              :class="{ 'text-success': r.status === 'done', 'text-error': r.status === 'failed', 'animate-spin text-primary': r.status === 'queued' || r.status === 'running' }"
            />
            <div class="min-w-0 flex-1 text-sm">
              <p>
                {{ r.status === 'done' ? `${formatTimecode((r.durationMs ?? 0) / 1000)} · ${formatBytes(r.bytes ?? 0)}` : r.status === 'failed' ? 'Failed' : jobFor(r)?.status === 'running' ? `Exporting… ${Math.round((jobFor(r)?.progress ?? 0) * 100)}%` : 'Waiting to export' }}
                <UBadge v-if="r.clipVersion !== editor.version.value && r.status === 'done'" label="Older edit" color="neutral" variant="subtle" size="sm" class="ml-1" />
              </p>
              <p class="text-xs text-muted">{{ timeAgo(r.finishedAt ?? r.createdAt, now) }}<template v-if="r.error"> · {{ r.error }}</template></p>
            </div>
            <template v-if="r.status === 'done'">
              <UButton icon="i-lucide-play" color="neutral" variant="ghost" size="sm" aria-label="Play export" @click="playing = playing === r.id ? null : r.id" />
              <UButton label="Download" icon="i-lucide-download" size="sm" :to="`/api/renders/${r.id}/download`" external download />
            </template>
            <ConfirmButton v-else-if="jobFor(r)" label="Stop" confirm-label="Stop export?" @confirm="cancel(jobFor(r)!.id)" />
          </div>
          <UProgress v-if="jobFor(r)?.status === 'running'" :model-value="Math.round((jobFor(r)?.progress ?? 0) * 100)" size="xs" />
          <video v-if="playing === r.id" :src="`/api/renders/${r.id}/download?inline=1`" controls autoplay class="mx-auto aspect-[9/16] max-h-96 rounded-lg bg-black" />
        </li>
      </ul>
    </div>

    <UModal v-model:open="confirmOpen" title="Export this clip?" description="It's rendered on this Mac; you can keep editing while it runs.">
      <template #body>
        <dl class="space-y-2 text-sm">
          <div v-for="row in summary" :key="row.label" class="flex justify-between gap-6">
            <dt class="text-muted">{{ row.label }}</dt>
            <dd class="truncate text-right">{{ row.value }}</dd>
          </div>
        </dl>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="confirmOpen = false" />
          <UButton label="Export MP4" icon="i-lucide-film" :loading="starting" @click="start" />
        </div>
      </template>
    </UModal>
  </div>
</template>
