<script setup lang="ts">
import { CLIP_IDEAL_MAX_MS, CLIP_IDEAL_MIN_MS, formatTimecode, type ClipDto, type ProposalDto } from '@clipstudio/core/shared'

const props = defineProps<{ proposal: ProposalDto; focusedClipId?: string | null }>()
const emit = defineEmits<{ updated: [proposal: ProposalDto]; focus: [clipId: string] }>()
const toast = useToast()
const now = useNow()
const busy = ref<string | null>(null)

const pending = computed(() => props.proposal.status === 'pending')
const open = computed(() => props.proposal.clips.filter((c) => c.status === 'proposed'))
const clientName = computed(() => {
  const c = props.proposal.client
  if (!c) return 'Claude'
  return c.replace(/[-_]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
})

async function post<T>(url: string, body: unknown, key: string): Promise<T | null> {
  busy.value = key
  try {
    // Plain signature: Nitro's typed-route inference blows up on a dynamic URL string.
    const post = $fetch as unknown as (url: string, opts: { method: 'POST'; body: unknown }) => Promise<T>
    return await post(url, { method: 'POST', body })
  } catch (e) {
    toast.add({ title: 'Something went wrong', description: (e as Error).message, color: 'error' })
    return null
  } finally {
    busy.value = null
  }
}

async function decide(clips: ClipDto[], approve: boolean, key: string) {
  if (!clips.length) return
  const updated = await post<ProposalDto>(
    `/api/proposals/${props.proposal.id}/clips`,
    { decisions: clips.map((c) => ({ clipId: c.id, approve })) },
    key,
  )
  if (updated) emit('updated', updated)
}

async function dismiss() {
  const updated = await post<ProposalDto>(`/api/proposals/${props.proposal.id}/dismiss`, {}, 'dismiss')
  if (updated) emit('updated', updated)
}

async function approveImport() {
  const updated = await post<ProposalDto>(`/api/proposals/${props.proposal.id}/approve-import`, {}, 'import')
  if (updated) {
    toast.add({
      title: 'Download started',
      description: props.proposal.import?.meta.title,
      icon: 'i-lucide-download',
      actions: updated.resultProjectId ? [{ label: 'Open project', to: `/projects/${updated.resultProjectId}` }] : undefined,
    })
    emit('updated', updated)
  }
}

function lengthNote(c: ClipDto) {
  const ms = c.endMs - c.startMs
  if (ms < CLIP_IDEAL_MIN_MS) return 'Short for a Short'
  if (ms > CLIP_IDEAL_MAX_MS) return 'Long for a Short'
  return null
}

defineExpose({ decide })
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-xs text-muted">
            From {{ clientName }} · {{ timeAgo(proposal.createdAt, now) }}
            <template v-if="proposal.projectId && proposal.projectName">
              ·
              <ULink :to="`/projects/${proposal.projectId}`" class="text-muted hover:text-default">{{ proposal.projectName }}</ULink>
            </template>
          </p>
          <h2 class="mt-0.5 font-semibold text-highlighted">{{ proposal.title }}</h2>
        </div>
        <div v-if="pending && proposal.kind === 'clips'" class="flex gap-2">
          <UButton
            :label="open.length === proposal.clips.length ? `Approve all ${open.length}` : `Approve remaining ${open.length}`"
            icon="i-lucide-check-check"
            size="sm"
            :loading="busy === 'all'"
            :disabled="!open.length"
            @click="decide(open, true, 'all')"
          />
          <UButton label="Dismiss" color="neutral" variant="ghost" size="sm" :loading="busy === 'dismiss'" @click="dismiss" />
        </div>
        <UBadge
          v-else-if="!pending"
          :label="proposal.status === 'dismissed' ? 'Dismissed' : 'Done'"
          :color="proposal.status === 'dismissed' ? 'neutral' : 'success'"
          variant="subtle"
        />
      </div>
      <blockquote v-if="proposal.note" class="mt-3 border-l-2 border-primary/50 pl-3 text-sm text-muted">{{ proposal.note }}</blockquote>
    </template>

    <!-- Clips -->
    <ul v-if="proposal.kind === 'clips'" class="divide-y divide-default">
      <li
        v-for="clip in proposal.clips"
        :key="clip.id"
        class="flex flex-col gap-4 p-4 transition sm:flex-row sm:px-6"
        :class="{ 'bg-elevated/60 ring-2 ring-primary ring-inset': focusedClipId === clip.id, 'opacity-60': clip.status === 'rejected' }"
        @click="emit('focus', clip.id)"
      >
        <ClipPreview :project-id="clip.projectId" :start-ms="clip.startMs" :end-ms="clip.endMs" class="w-full shrink-0 sm:w-64" />
        <div class="min-w-0 flex-1 space-y-2">
          <div class="flex items-start gap-2">
            <p class="flex-1 font-medium text-highlighted">{{ clip.title }}</p>
            <UBadge v-if="clip.score !== null" :label="`${clip.score}`" icon="i-lucide-flame" color="warning" variant="subtle" size="sm" />
          </div>
          <p class="text-xs text-muted tabular-nums">
            {{ formatTimecode(clip.startMs / 1000) }}–{{ formatTimecode(clip.endMs / 1000) }} · {{ formatTimecode((clip.endMs - clip.startMs) / 1000) }}
            <span v-if="lengthNote(clip)" class="text-warning"> · {{ lengthNote(clip) }}</span>
          </p>
          <p v-if="clip.hook" class="text-sm"><span class="text-muted">Hook:</span> “{{ clip.hook }}”</p>
          <p v-if="clip.reason" class="text-sm text-muted">{{ clip.reason }}</p>
          <div v-if="clip.keywords.length" class="flex flex-wrap gap-1">
            <UBadge v-for="k in clip.keywords" :key="k" :label="k" color="neutral" variant="outline" size="sm" />
          </div>
          <div class="flex gap-2 pt-1">
            <template v-if="clip.status === 'proposed' && pending">
              <UButton label="Approve" icon="i-lucide-check" size="sm" :loading="busy === clip.id + 'y'" @click.stop="decide([clip], true, clip.id + 'y')" />
              <UButton label="Reject" icon="i-lucide-x" color="neutral" variant="outline" size="sm" :loading="busy === clip.id + 'n'" @click.stop="decide([clip], false, clip.id + 'n')" />
            </template>
            <UBadge v-else-if="clip.status === 'approved'" label="Approved" icon="i-lucide-check" color="success" variant="subtle" />
            <UBadge v-else-if="clip.status === 'rejected'" label="Rejected" icon="i-lucide-x" color="neutral" variant="subtle" />
          </div>
        </div>
      </li>
    </ul>

    <!-- Schedule -->
    <div v-else-if="proposal.schedule" class="space-y-3 p-4 sm:px-6">
      <p class="text-sm">
        {{ proposal.schedule.clipIds.length }} {{ proposal.schedule.clipIds.length === 1 ? 'clip' : 'clips' }}
        <template v-if="proposal.schedule.date"> on {{ new Date(`${proposal.schedule.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) }}</template>.
        You choose the accounts and check every time and text in the scheduler.
      </p>
      <div v-if="pending" class="flex gap-2">
        <UButton label="Open in scheduler" icon="i-lucide-calendar-plus" size="sm" :to="`/schedule?proposal=${proposal.id}`" />
        <UButton label="Dismiss" color="neutral" variant="outline" size="sm" :loading="busy === 'dismiss'" @click="dismiss" />
      </div>
    </div>

    <!-- Import -->
    <div v-else-if="proposal.import" class="flex flex-col gap-4 p-4 sm:flex-row sm:px-6">
      <img :src="proposal.import.meta.thumbnailUrl" alt="" class="aspect-video w-full shrink-0 self-start rounded-md object-cover sm:w-64" />
      <div class="min-w-0 flex-1 space-y-2">
        <p class="font-medium text-highlighted">{{ proposal.import.meta.title }}</p>
        <p class="text-sm text-muted">
          {{ proposal.import.meta.channel }}
          <template v-if="proposal.import.meta.durationSec"> · {{ formatTimecode(proposal.import.meta.durationSec) }}</template>
          · {{ proposal.import.quality === 'best' ? 'best quality' : `${proposal.import.quality}p` }}
          <template v-if="proposal.import.range">
            · only {{ formatTimecode(proposal.import.range.start) }}–{{ formatTimecode(Math.min(proposal.import.range.end, proposal.import.meta.durationSec ?? proposal.import.range.end)) }}
          </template>
        </p>
        <ULink :to="proposal.import.url" target="_blank" class="inline-flex items-center gap-1 text-sm">
          Open on YouTube <UIcon name="i-lucide-external-link" class="size-3" />
        </ULink>
        <p class="text-xs text-muted">Only download videos you own or have permission to use.</p>
        <div v-if="pending" class="flex gap-2 pt-1">
          <UButton label="Download" icon="i-lucide-download" size="sm" :loading="busy === 'import'" @click="approveImport" />
          <UButton label="Dismiss" color="neutral" variant="outline" size="sm" :loading="busy === 'dismiss'" @click="dismiss" />
        </div>
        <UButton
          v-else-if="proposal.resultProjectId"
          label="Open project"
          icon="i-lucide-arrow-up-right"
          color="neutral"
          variant="outline"
          size="sm"
          :to="`/projects/${proposal.resultProjectId}`"
        />
      </div>
    </div>
  </UCard>
</template>
