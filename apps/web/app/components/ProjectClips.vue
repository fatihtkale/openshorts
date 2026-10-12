<script setup lang="ts">
import { formatTimecode, type ClipDto, type ProjectDto } from '@clipstudio/core/shared'

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
          <p class="truncate text-sm font-medium">{{ clip.title }}</p>
          <p class="text-xs text-muted tabular-nums">
            {{ formatTimecode(clip.startMs / 1000) }}–{{ formatTimecode(clip.endMs / 1000) }} · {{ formatTimecode((clip.endMs - clip.startMs) / 1000) }}
            · {{ clip.origin === 'claude' ? 'by Claude' : 'made by you' }}
          </p>
        </div>
        <ConfirmButton label="Remove" confirm-label="Remove clip?" class="opacity-0 group-hover:opacity-100 focus:opacity-100" @confirm="remove(clip)" />
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
          Claude isn't connected yet. <ULink to="/settings" class="text-primary">Connect Claude</ULink> first.
        </template>
        Or select words in the transcript to make a clip yourself.
      </p>
    </div>
  </UCard>
</template>
