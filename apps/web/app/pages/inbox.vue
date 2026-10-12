<script setup lang="ts">
import type { ProposalDto } from '@clipstudio/core/shared'

const tab = ref<'pending' | 'history'>('pending')
const { data: proposals, refresh } = await useFetch<ProposalDto[]>('/api/inbox', { default: () => [] })
const { pending: pendingCount } = useInboxCount()

// New proposals can arrive at any moment; the sidebar poll notices first.
watch(pendingCount, () => void refresh())

const pendingList = computed(() => proposals.value.filter((p) => p.status === 'pending'))
const history = computed(() => proposals.value.filter((p) => p.status !== 'pending'))
const shown = computed(() => (tab.value === 'pending' ? pendingList.value : history.value))

function onUpdated(updated: ProposalDto) {
  proposals.value = proposals.value.map((p) => (p.id === updated.id ? updated : p))
  pendingCount.value = proposals.value.filter((p) => p.status === 'pending').length
}

// ── Keyboard review: J/K to move, A to approve, R to reject ─────────
const focused = ref<string | null>(null)
const openClips = computed(() =>
  pendingList.value.flatMap((p) => p.clips.filter((c) => c.status === 'proposed').map((c) => ({ clip: c, proposalId: p.id }))),
)
const cards = ref<Record<string, { decide: (clips: ProposalDto['clips'], approve: boolean, key: string) => Promise<void> }>>({})

function move(step: number) {
  const list = openClips.value
  if (!list.length) return
  const i = list.findIndex((x) => x.clip.id === focused.value)
  focused.value = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + step))]!.clip.id
  nextTick(() => document.querySelector('.ring-primary')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}

async function decideFocused(approve: boolean) {
  const entry = openClips.value.find((x) => x.clip.id === focused.value)
  if (!entry) return
  const next = openClips.value[openClips.value.indexOf(entry) + 1]?.clip.id ?? null
  await cards.value[entry.proposalId]?.decide([entry.clip], approve, entry.clip.id + (approve ? 'y' : 'n'))
  focused.value = next ?? openClips.value[0]?.clip.id ?? null
}

function onKey(e: KeyboardEvent) {
  if (tab.value !== 'pending' || e.metaKey || e.ctrlKey || e.altKey) return
  if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return
  const key = e.key.toLowerCase()
  if (key === 'j') move(1)
  else if (key === 'k') move(-1)
  else if (key === 'a') void decideFocused(true)
  else if (key === 'r') void decideFocused(false)
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <PageShell title="Inbox">
    <div class="mx-auto w-full max-w-4xl space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <UTabs
          v-model="tab"
          :items="[
            { label: `To review${pendingList.length ? ` (${pendingList.length})` : ''}`, value: 'pending' },
            { label: 'History', value: 'history' },
          ]"
          :content="false"
          size="sm"
        />
        <p v-if="tab === 'pending' && openClips.length" class="ml-auto hidden text-xs text-muted sm:block">
          <UKbd value="J" /> <UKbd value="K" /> move · <UKbd value="A" /> approve · <UKbd value="R" /> reject
        </p>
      </div>

      <UEmpty
        v-if="!shown.length"
        icon="i-lucide-inbox"
        :title="tab === 'pending' ? 'Nothing to review' : 'No history yet'"
        :description="
          tab === 'pending'
            ? 'When Claude suggests clips or a video to import, it shows up here. Nothing happens until you approve it.'
            : 'Proposals you approved or dismissed are listed here.'
        "
        :actions="tab === 'pending' ? [{ label: 'How to connect Claude', icon: 'i-lucide-plug', to: '/settings', color: 'neutral', variant: 'outline' }] : undefined"
        variant="naked"
        class="py-16"
      />

      <ProposalCard
        v-for="p in shown"
        :key="p.id"
        :ref="(el) => { if (el) cards[p.id] = el as never }"
        :proposal="p"
        :focused-clip-id="focused"
        @updated="onUpdated"
        @focus="(id) => (focused = id)"
      />
    </div>
  </PageShell>
</template>
