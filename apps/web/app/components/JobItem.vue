<script setup lang="ts">
import type { JobDto } from '@clipstudio/core/shared'

const props = defineProps<{ job: JobDto }>()
const { cancel, retry } = useJobs()
const now = useNow()
const toast = useToast()

const statusIcon = computed(() => {
  switch (props.job.status) {
    case 'queued':
      return { name: 'i-lucide-clock', class: 'text-muted' }
    case 'running':
      return { name: 'i-lucide-loader-circle', class: 'text-primary animate-spin' }
    case 'succeeded':
      return { name: 'i-lucide-circle-check', class: 'text-success' }
    case 'failed':
      return { name: 'i-lucide-circle-x', class: 'text-error' }
    default:
      return { name: 'i-lucide-ban', class: 'text-muted' }
  }
})

const percent = computed(() => Math.round(props.job.progress * 100))

const subtitle = computed(() => {
  const j = props.job
  if (j.status === 'queued' && j.runAt > now.value) return j.message ?? `Starts ${timeAgo(j.runAt, now.value)}`
  if (j.status === 'queued') return j.message ?? 'Waiting for the worker'
  if (j.status === 'running') return j.message ?? 'Starting…'
  if (j.status === 'succeeded') return `Finished ${timeAgo(j.finishedAt ?? j.updatedAt, now.value)}`
  if (j.status === 'cancelled') return `Cancelled ${timeAgo(j.finishedAt ?? j.updatedAt, now.value)}`
  return `Failed after ${j.attempts} ${j.attempts === 1 ? 'try' : 'tries'}`
})

async function run(action: (id: string) => Promise<void>, failure: string) {
  try {
    await action(props.job.id)
  } catch (error) {
    toast.add({ title: failure, description: (error as Error).message, color: 'error' })
  }
}
</script>

<template>
  <div class="flex gap-3 py-3">
    <UIcon :name="statusIcon.name" class="mt-0.5 size-5 shrink-0" :class="statusIcon.class" />
    <div class="min-w-0 flex-1 space-y-1.5">
      <div class="flex items-baseline justify-between gap-2">
        <p class="truncate text-sm font-medium text-highlighted">{{ job.label }}</p>
        <span v-if="job.status === 'running'" class="text-xs tabular-nums text-muted">{{ percent }}%</span>
      </div>
      <UProgress v-if="job.status === 'running'" :model-value="percent" size="xs" />
      <p class="text-xs text-muted">{{ subtitle }}</p>
      <p v-if="job.error && job.status !== 'succeeded'" class="text-xs text-error">{{ job.error }}</p>
    </div>
    <div class="shrink-0">
      <ConfirmButton
        v-if="(job.status === 'queued' || job.status === 'running') && !job.cancelRequested"
        label="Cancel"
        confirm-label="Cancel job?"
        @confirm="run(cancel, 'Could not cancel')"
      />
      <UButton
        v-else-if="job.status === 'failed' || job.status === 'cancelled'"
        label="Retry"
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="run(retry, 'Could not retry')"
      />
    </div>
  </div>
</template>
