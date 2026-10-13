<script setup lang="ts">
import {
  COMMON_TIME_ZONES,
  computeInsights,
  formatInZone,
  formatTimecode,
  PLATFORM_LABELS,
  planTimes,
  scheduleWarnings,
  suggestPostText,
  TIKTOK_PRIVACY_LABELS,
  zonedDate,
  zoneLabel,
  type AccountDto,
  type CalendarPost,
  type ClipDto,
  type InsightPost,
  type PostDto,
  type ProposalDto,
  type ScheduleDefaults,
  type SpreadMode,
  type TiktokPrivacyLevel,
} from '@clipstudio/core/shared'

/**
 * The scheduler: pick clips → pick accounts → pick a day → review the timeline → confirm.
 * Nothing is scheduled until the last button.
 */
interface Candidate {
  clip: ClipDto
  projectName: string
  posts: number
}

const route = useRoute()
const toast = useToast()
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const { data: candidates } = await useFetch<Candidate[]>('/api/schedule/candidates', { default: () => [] })
const { data: accountsRes } = await useFetch<{ accounts: AccountDto[] }>('/api/accounts')
const { data: defaults } = await useFetch<ScheduleDefaults>('/api/settings/schedule')
const accounts = computed(() => (accountsRes.value?.accounts ?? []).filter((a) => a.status === 'connected'))

const step = ref(0)
const steps = [
  { title: 'Clips', icon: 'i-lucide-film' },
  { title: 'Accounts', icon: 'i-lucide-at-sign' },
  { title: 'Day', icon: 'i-lucide-calendar-days' },
  { title: 'Review', icon: 'i-lucide-list-checks' },
]

// ── Step 1: clips (in posting order) ─────────────────────────────────
const clipIds = ref<string[]>([])
const hidePosted = ref(true)
const visibleCandidates = computed(() => candidates.value.filter((c) => !hidePosted.value || c.posts === 0 || clipIds.value.includes(c.clip.id)))
const byId = computed(() => new Map(candidates.value.map((c) => [c.clip.id, c])))
function toggleClip(id: string) {
  clipIds.value = clipIds.value.includes(id) ? clipIds.value.filter((x) => x !== id) : [...clipIds.value, id]
}

// ── Step 2: accounts ─────────────────────────────────────────────────
const accountIds = ref<string[]>([])
const offsetMin = ref(0)
const selectedAccounts = computed(() => accounts.value.filter((a) => accountIds.value.includes(a.id)))
function toggleAccount(id: string) {
  accountIds.value = accountIds.value.includes(id) ? accountIds.value.filter((x) => x !== id) : [...accountIds.value, id]
}
watch(
  accounts,
  (list) => {
    if (!accountIds.value.length && list.length === 1) accountIds.value = [list[0]!.id]
  },
  { immediate: true },
)

interface TiktokChoice {
  loading: boolean
  error: string | null
  username: string
  options: TiktokPrivacyLevel[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxDurationSec: number
  mode: 'direct' | 'draft'
  privacy: TiktokPrivacyLevel | undefined
  allowComments: boolean
  allowDuet: boolean
  allowStitch: boolean
  aiGenerated: boolean
}
const tiktok = reactive<Record<string, TiktokChoice>>({})
watch(
  selectedAccounts,
  async (list) => {
    for (const a of list) {
      if (a.platform !== 'tiktok' || tiktok[a.id]) continue
      tiktok[a.id] = {
        loading: true, error: null, username: '', options: [], commentDisabled: false, duetDisabled: false, stitchDisabled: false,
        maxDurationSec: 600, mode: 'direct', privacy: undefined, allowComments: true, allowDuet: true, allowStitch: true, aiGenerated: false,
      }
      try {
        const info = await $fetch<{ username: string; privacyOptions: TiktokPrivacyLevel[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxDurationSec: number }>(
          `/api/accounts/${a.id}/creator`,
        )
        Object.assign(tiktok[a.id]!, {
          loading: false,
          username: info.username,
          options: info.privacyOptions,
          commentDisabled: info.commentDisabled,
          duetDisabled: info.duetDisabled,
          stitchDisabled: info.stitchDisabled,
          maxDurationSec: info.maxDurationSec,
          allowComments: !info.commentDisabled,
          allowDuet: !info.duetDisabled,
          allowStitch: !info.stitchDisabled,
        })
      } catch (e) {
        Object.assign(tiktok[a.id]!, { loading: false, error: (e as { statusMessage?: string }).statusMessage ?? (e as Error).message })
      }
    }
  },
  { immediate: true },
)

// ── Step 3: day ──────────────────────────────────────────────────────
const timeZone = ref('America/New_York')
const windowStart = ref('12:00')
const windowEnd = ref('21:00')
const mode = ref<SpreadMode>('edges')
const jitterMin = ref(0)
const minGapMin = ref(90)
const date = ref('')
const customTimes = ref<string[]>([])
const now = useNow(30_000)

watch(
  defaults,
  (d) => {
    if (!d) return
    timeZone.value = d.timeZone
    windowStart.value = d.windowStart
    windowEnd.value = d.windowEnd
    mode.value = d.mode
    jitterMin.value = d.jitterMin
    minGapMin.value = d.minGapMin
    if (!date.value) date.value = zonedDate(Date.now() + 86_400_000, d.timeZone)
  },
  { immediate: true },
)

// What past posts say about the best hours (only once there's enough data).
const { data: insightPosts } = await useFetch<{ posts: InsightPost[] }>('/api/insights', { server: false, default: () => ({ posts: [] }) })
const bestWindow = computed(() => {
  if (!insightPosts.value.posts.length) return null
  const s = computeInsights(insightPosts.value.posts, { timeZone: timeZone.value, windowStart: windowStart.value, windowEnd: windowEnd.value }).suggestion
  return s && (s.start !== windowStart.value || s.end !== windowEnd.value) ? s : null
})

// A proposal from Claude pre-fills the clips (and day).
const proposalId = computed(() => (typeof route.query.proposal === 'string' ? route.query.proposal : null))
const { data: inbox } = await useFetch<ProposalDto[]>('/api/inbox', { query: { status: 'pending' }, immediate: !!proposalId.value, default: () => [] })
const proposal = computed(() => inbox.value.find((p) => p.id === proposalId.value && p.kind === 'schedule') ?? null)
watch(
  [proposal, candidates],
  () => {
    const p = proposal.value?.schedule
    if (!p || clipIds.value.length) return
    clipIds.value = p.clipIds.filter((id) => byId.value.has(id))
    if (p.date) date.value = p.date
  },
  { immediate: true },
)

const plan = computed(() => {
  try {
    if (mode.value === 'custom' && customTimes.value.length !== clipIds.value.length) {
      const base = planTimes({ date: date.value, timeZone: timeZone.value, windowStart: windowStart.value, windowEnd: windowEnd.value, count: clipIds.value.length, mode: 'edges', now: now.value })
      customTimes.value = base.times.map((t) => formatInZone(t, timeZone.value))
    }
    return {
      ...planTimes({
        date: date.value,
        timeZone: timeZone.value,
        windowStart: windowStart.value,
        windowEnd: windowEnd.value,
        count: clipIds.value.length,
        mode: mode.value,
        jitterMin: jitterMin.value,
        customTimes: customTimes.value,
        now: now.value,
        seed: date.value.split('-').reduce((a, b) => a * 31 + Number(b), 7),
      }),
      error: null as string | null,
    }
  } catch (e) {
    return { times: [] as number[], notes: [] as string[], error: (e as Error).message }
  }
})

// ── Step 4: review ───────────────────────────────────────────────────
interface Row {
  clipId: string
  accountId: string
  time: number
}
const rows = computed<Row[]>(() =>
  clipIds.value.flatMap((clipId, i) =>
    selectedAccounts.value.map((a, k) => ({ clipId, accountId: a.id, time: (plan.value.times[i] ?? 0) + k * offsetMin.value * 60_000 })),
  ),
)
const sortedRows = computed(() => [...rows.value].sort((a, b) => a.time - b.time))

// Texts per clip × account, starting from suggestions.
const texts = reactive<Record<string, { title: string; description: string }>>({})
function textFor(row: Row) {
  const key = `${row.clipId}:${row.accountId}`
  if (!texts[key]) {
    const clip = byId.value.get(row.clipId)!.clip
    const platform = accounts.value.find((a) => a.id === row.accountId)!.platform
    const s = suggestPostText(clip, platform)
    texts[key] = { title: s.title, description: s.description }
  }
  return texts[key]!
}
const editing = ref<string | null>(null)

// Existing posts that day, to warn about clashes.
const { data: existing } = await useFetch<CalendarPost[]>('/api/posts', {
  query: computed(() => ({ from: plan.value.times[0] ? plan.value.times[0] - 86_400_000 : 0, to: plan.value.times[0] ? plan.value.times[0] + 2 * 86_400_000 : 1 })),
  default: () => [],
  immediate: false,
  watch: false,
})
watch(step, (s) => {
  if (s === 3 && plan.value.times[0]) void refreshExisting()
})
async function refreshExisting() {
  existing.value = await $fetch<CalendarPost[]>('/api/posts', { query: { from: plan.value.times[0]! - 86_400_000, to: plan.value.times[0]! + 2 * 86_400_000 } })
}

const warnings = computed(() =>
  scheduleWarnings(
    sortedRows.value.map((r) => ({ time: r.time, accountId: r.accountId, platform: accounts.value.find((a) => a.id === r.accountId)!.platform })),
    {
      minGapMin: minGapMin.value,
      localTimeZone: localZone,
      existing: existing.value
        .filter((p) => p.accountId && p.status !== 'cancelled' && p.scheduledAt)
        .map((p) => ({ time: p.scheduledAt!, accountId: p.accountId! })),
    },
  ),
)

/** Moves a clip one slot earlier or later (its time follows the slot). */
function move(clipId: string, step: number) {
  const i = clipIds.value.indexOf(clipId)
  const j = i + step
  if (j < 0 || j >= clipIds.value.length) return
  const next = [...clipIds.value]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  clipIds.value = next
}

/** Typing a time switches to custom times. */
function setTime(clipId: string, hhmm: string) {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return
  const current = plan.value.times.map((t) => formatInZone(t, timeZone.value))
  current[clipIds.value.indexOf(clipId)] = hhmm
  customTimes.value = current
  mode.value = 'custom'
}

// ── Checks per step ──────────────────────────────────────────────────
const stepProblem = computed<string | null>(() => {
  if (step.value === 0) return clipIds.value.length ? null : 'Pick at least one clip'
  if (step.value === 1) {
    if (!selectedAccounts.value.length) return 'Pick at least one account'
    for (const a of selectedAccounts.value) {
      if (a.platform !== 'tiktok') continue
      const t = tiktok[a.id]
      if (!t || t.loading) return 'Loading TikTok settings…'
      if (t.error) return `${a.displayName}: ${t.error}`
      if (t.mode === 'direct' && !t.privacy) return `${a.displayName}: choose who can see the posts`
      const tooLong = clipIds.value.find((id) => (byId.value.get(id)?.clip.render?.durationMs ?? 0) / 1000 > t.maxDurationSec)
      if (tooLong) return `${a.displayName} can post up to ${t.maxDurationSec} s; “${byId.value.get(tooLong)!.clip.title}” is longer`
    }
    return null
  }
  if (step.value === 2) return plan.value.error
  return null
})

const confirming = ref(false)
async function confirm() {
  confirming.value = true
  try {
    const created = await $fetch<PostDto[]>('/api/schedule', {
      method: 'POST',
      body: {
        batch: { date: date.value, timeZone: timeZone.value, windowStart: windowStart.value, windowEnd: windowEnd.value, mode: mode.value, jitterMin: jitterMin.value },
        proposalId: proposal.value?.id,
        items: sortedRows.value.map((r) => {
          const account = accounts.value.find((a) => a.id === r.accountId)!
          const clip = byId.value.get(r.clipId)!.clip
          const text = textFor(r)
          const t = tiktok[account.id]
          return {
            renderId: clip.render!.id,
            accountId: account.id,
            title: text.title,
            description: text.description,
            scheduledAt: r.time,
            youtube: account.platform === 'youtube' ? { privacy: 'public', tags: clip.keywords.slice(0, 10), madeForKids: false } : undefined,
            tiktok:
              account.platform === 'tiktok' && t
                ? {
                    mode: t.mode,
                    privacy: t.mode === 'direct' ? (t.privacy ?? null) : null,
                    allowComments: t.allowComments,
                    allowDuet: t.allowDuet,
                    allowStitch: t.allowStitch,
                    brandContent: false,
                    brandOrganic: false,
                    aiGenerated: t.aiGenerated,
                  }
                : undefined,
          }
        }),
      },
    })
    toast.add({ title: `${created.length} ${created.length === 1 ? 'post' : 'posts'} scheduled`, icon: 'i-lucide-calendar-check', color: 'success' })
    await navigateTo(`/calendar?date=${date.value}`)
  } catch (e) {
    toast.add({ title: 'Could not schedule', description: (e as Error).message, color: 'error' })
  } finally {
    confirming.value = false
  }
}

function privacyItems(accountId: string) {
  return (tiktok[accountId]?.options ?? []).map((o) => ({ label: TIKTOK_PRIVACY_LABELS[o], value: o }))
}

const zoneItems = computed(() => [...new Set([timeZone.value, localZone, ...COMMON_TIME_ZONES])].map((z) => ({ label: z.replace(/_/g, ' '), value: z })))
const accountName = (id: string) => accounts.value.find((a) => a.id === id)?.displayName ?? ''
const platformOf = (id: string) => accounts.value.find((a) => a.id === id)!.platform
</script>

<template>
  <PageShell title="Schedule posts">
    <div class="mx-auto w-full max-w-4xl space-y-6">
      <UAlert
        v-if="proposal"
        color="primary"
        variant="subtle"
        icon="i-lucide-sparkles"
        :title="proposal.title"
        :description="proposal.note ?? 'Suggested by Claude. Check everything before you confirm.'"
      />

      <UStepper v-model="step" :items="steps" :linear="false" size="sm" class="w-full" />

      <!-- 1. Clips -->
      <UCard v-if="step === 0">
        <template #header>
          <div class="flex items-center gap-3">
            <div class="flex-1">
              <h2 class="font-semibold">Which clips?</h2>
              <p class="text-sm text-muted">Exported clips from all projects. They post in the order you pick them.</p>
            </div>
            <USwitch v-model="hidePosted" label="Hide posted" size="sm" />
          </div>
        </template>
        <UEmpty
          v-if="!visibleCandidates.length"
          icon="i-lucide-film"
          title="No exported clips"
          description="Export clips in the editor first; then they can be scheduled here."
          variant="naked"
        />
        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <button
            v-for="c in visibleCandidates"
            :key="c.clip.id"
            type="button"
            class="relative overflow-hidden rounded-lg border text-left transition hover:border-accented"
            :class="clipIds.includes(c.clip.id) ? 'border-primary ring-2 ring-primary/40' : 'border-default'"
            @click="toggleClip(c.clip.id)"
          >
            <img :src="`/api/projects/${c.clip.projectId}/frame?t=${c.clip.startMs + 400}&w=320`" alt="" class="aspect-video w-full object-cover" loading="lazy" />
            <span v-if="clipIds.includes(c.clip.id)" class="absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-primary text-xs font-bold text-inverted">
              {{ clipIds.indexOf(c.clip.id) + 1 }}
            </span>
            <div class="space-y-0.5 p-2">
              <p class="truncate text-sm font-medium">{{ c.clip.title }}</p>
              <p class="truncate text-xs text-muted">{{ c.projectName }} · {{ formatTimecode((c.clip.render?.durationMs ?? 0) / 1000) }}</p>
              <p v-if="c.posts" class="text-xs text-warning">Posted {{ c.posts }}×</p>
              <p v-if="c.clip.render && c.clip.render.clipVersion < c.clip.version" class="text-xs text-warning">Edited since the export</p>
            </div>
          </button>
        </div>
      </UCard>

      <!-- 2. Accounts -->
      <UCard v-else-if="step === 1">
        <template #header>
          <h2 class="font-semibold">Where?</h2>
          <p class="text-sm text-muted">Each clip goes to every account you pick.</p>
        </template>
        <UEmpty v-if="!accounts.length" icon="i-lucide-at-sign" title="No accounts connected" :actions="[{ label: 'Go to Accounts', to: '/accounts' }]" variant="naked" />
        <div v-else class="space-y-4">
          <div v-for="a in accounts" :key="a.id" class="rounded-lg border border-default p-3">
            <UCheckbox :model-value="accountIds.includes(a.id)" @update:model-value="toggleAccount(a.id)">
              <template #label>
                <span class="flex items-center gap-2">
                  <UIcon :name="a.platform === 'youtube' ? 'i-simple-icons-youtube' : 'i-simple-icons-tiktok'" />
                  {{ a.displayName }}
                </span>
              </template>
            </UCheckbox>
            <div v-if="accountIds.includes(a.id)" class="mt-3 space-y-3 pl-7 text-sm">
              <p v-if="a.platform === 'youtube'" class="text-muted">
                Uploaded right away as private; YouTube makes each video public at its time, even if this Mac is off.
              </p>
              <template v-else-if="tiktok[a.id]">
                <USkeleton v-if="tiktok[a.id]!.loading" class="h-16 w-full" />
                <UAlert v-else-if="tiktok[a.id]!.error" color="error" variant="subtle" :title="tiktok[a.id]!.error!" />
                <template v-else>
                  <p class="text-muted">Posted by this Mac at each time, so it needs to be awake then.</p>
                  <URadioGroup
                    v-model="tiktok[a.id]!.mode"
                    orientation="horizontal"
                    :items="[
                      { label: 'Post to profile', value: 'direct' },
                      { label: 'Send to drafts', value: 'draft' },
                    ]"
                  />
                  <template v-if="tiktok[a.id]!.mode === 'direct'">
                    <UFormField label="Who can see them">
                      <USelect
                        v-model="tiktok[a.id]!.privacy"
                        :items="privacyItems(a.id)"
                        value-key="value"
                        placeholder="Choose…"
                        class="w-56"
                      />
                    </UFormField>
                    <div class="flex flex-wrap gap-x-6 gap-y-2">
                      <USwitch v-model="tiktok[a.id]!.allowComments" label="Comments" :disabled="tiktok[a.id]!.commentDisabled" />
                      <USwitch v-model="tiktok[a.id]!.allowDuet" label="Duet" :disabled="tiktok[a.id]!.duetDisabled" />
                      <USwitch v-model="tiktok[a.id]!.allowStitch" label="Stitch" :disabled="tiktok[a.id]!.stitchDisabled" />
                    </div>
                  </template>
                  <p class="text-xs text-muted">
                    By posting, you agree to TikTok's
                    <ULink to="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" class="text-primary">Music Usage Confirmation</ULink>.
                    For promotional posts, use Post on a single clip instead, to add the disclosure.
                  </p>
                </template>
              </template>
            </div>
          </div>
          <UFormField v-if="selectedAccounts.length > 1" :label="`Space accounts apart by ${offsetMin} min`" help="0 posts everywhere at the same moment.">
            <USlider v-model="offsetMin" :min="0" :max="120" :step="5" class="max-w-xs" />
          </UFormField>
        </div>
      </UCard>

      <!-- 3. Day -->
      <UCard v-else-if="step === 2">
        <template #header>
          <h2 class="font-semibold">When?</h2>
          <p class="text-sm text-muted">Times are planned in your audience's time zone and shown in yours too.</p>
        </template>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Day">
            <UInput v-model="date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Audience time zone">
            <USelect v-model="timeZone" :items="zoneItems" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="From">
            <UInput v-model="windowStart" type="time" class="w-full" />
          </UFormField>
          <UFormField label="Until">
            <UInput v-model="windowEnd" type="time" class="w-full" />
          </UFormField>
        </div>
        <UAlert
          v-if="bestWindow"
          class="mt-4"
          color="info"
          variant="subtle"
          icon="i-lucide-lightbulb"
          :title="`Your posts did best between ${bestWindow.start} and ${bestWindow.end}`"
          :description="bestWindow.lift ? `${(1 + bestWindow.lift).toFixed(1)}× the views of ${windowStart}–${windowEnd}, across ${bestWindow.posts} posts.` : `Across ${bestWindow.posts} posts.`"
          :actions="[{ label: 'Use these hours', color: 'info', variant: 'outline', size: 'xs', onClick: () => { windowStart = bestWindow!.start; windowEnd = bestWindow!.end } }]"
        />
        <URadioGroup
          v-model="mode"
          class="mt-5"
          :items="[
            { label: 'Edge to edge', value: 'edges', description: 'First at the start, last at the end, evenly between.' },
            { label: 'Centred', value: 'centred', description: 'Each in the middle of an equal part of the window.' },
            { label: 'My own times', value: 'custom', description: 'Set each time in the review step.' },
          ]"
        />
        <UFormField v-if="mode !== 'custom'" :label="jitterMin ? `Vary times by up to ±${jitterMin} min` : 'Exact times'" class="mt-4 max-w-xs">
          <USlider v-model="jitterMin" :min="0" :max="30" :step="5" />
        </UFormField>

        <div class="mt-6 rounded-lg bg-elevated p-3">
          <p v-if="plan.error" class="text-sm text-error">{{ plan.error }}</p>
          <template v-else>
            <p class="mb-2 text-xs text-muted">{{ clipIds.length }} {{ clipIds.length === 1 ? 'post' : 'posts' }} per account:</p>
            <div class="flex flex-wrap gap-2">
              <span v-for="t in plan.times" :key="t" class="rounded-md bg-default px-2 py-1 text-sm tabular-nums">
                {{ formatInZone(t, timeZone) }} <span class="text-xs text-muted">{{ zoneLabel(t, timeZone) }}</span>
                <span v-if="localZone !== timeZone" class="text-xs text-muted"> · {{ formatInZone(t, localZone) }} yours</span>
              </span>
            </div>
            <p v-for="n in plan.notes" :key="n" class="mt-2 text-xs text-warning">{{ n }}</p>
          </template>
        </div>
      </UCard>

      <!-- 4. Review -->
      <template v-else>
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h2 class="font-semibold">{{ new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) }}</h2>
            <p class="text-sm text-muted">Check each post. Change a time by typing it; move a clip with the arrows.</p>
          </template>
          <ul class="divide-y divide-default">
            <li v-for="(r, i) in sortedRows" :key="`${r.clipId}:${r.accountId}`" class="flex gap-4 p-4 sm:px-6">
              <div class="w-24 shrink-0">
                <input
                  type="time"
                  :value="formatInZone(r.time, timeZone)"
                  class="w-full rounded-md border border-default bg-default px-1 py-0.5 text-lg font-semibold tabular-nums"
                  :disabled="selectedAccounts[0]?.id !== r.accountId"
                  :title="selectedAccounts[0]?.id !== r.accountId ? 'Follows the first account (plus the spacing)' : 'Change the time'"
                  @change="setTime(r.clipId, ($event.target as HTMLInputElement).value)"
                />
                <p class="mt-0.5 text-xs text-muted">{{ zoneLabel(r.time, timeZone) }}</p>
                <p v-if="localZone !== timeZone" class="text-xs text-muted">{{ formatInZone(r.time, localZone) }} yours</p>
              </div>
              <img :src="`/api/projects/${byId.get(r.clipId)!.clip.projectId}/frame?t=${byId.get(r.clipId)!.clip.startMs + 400}&w=320`" alt="" class="hidden aspect-video w-28 shrink-0 self-start rounded object-cover sm:block" />
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex items-center gap-2">
                  <UIcon :name="platformOf(r.accountId) === 'youtube' ? 'i-simple-icons-youtube' : 'i-simple-icons-tiktok'" class="size-4 shrink-0" />
                  <p class="truncate text-sm font-medium">{{ byId.get(r.clipId)!.clip.title }}</p>
                  <span class="truncate text-xs text-muted">→ {{ accountName(r.accountId) }}</span>
                </div>
                <template v-if="editing === `${r.clipId}:${r.accountId}`">
                  <UTextarea v-model="textFor(r).title" :rows="2" autoresize class="w-full" :placeholder="platformOf(r.accountId) === 'youtube' ? 'Title' : 'Caption'" />
                  <UTextarea v-if="platformOf(r.accountId) === 'youtube'" v-model="textFor(r).description" :rows="2" autoresize class="w-full" placeholder="Description" />
                  <UButton label="Done" size="xs" color="neutral" variant="outline" @click="editing = null" />
                </template>
                <button v-else type="button" class="block w-full truncate text-left text-sm text-muted hover:text-default" @click="editing = `${r.clipId}:${r.accountId}`">
                  {{ textFor(r).title || '(no caption)' }} <UIcon name="i-lucide-pencil" class="ml-1 size-3" />
                </button>
                <UBadge v-for="w in warnings.filter((w) => w.index === i)" :key="w.message" :label="w.message" icon="i-lucide-triangle-alert" color="warning" variant="subtle" size="sm" class="mr-1" />
              </div>
              <div v-if="selectedAccounts[0]?.id === r.accountId" class="flex flex-col gap-1">
                <UButton icon="i-lucide-chevron-up" color="neutral" variant="ghost" size="xs" aria-label="Earlier slot" @click="move(r.clipId, -1)" />
                <UButton icon="i-lucide-chevron-down" color="neutral" variant="ghost" size="xs" aria-label="Later slot" @click="move(r.clipId, 1)" />
              </div>
            </li>
          </ul>
        </UCard>
      </template>

      <div class="flex items-center gap-3">
        <UButton v-if="step > 0" label="Back" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="step--" />
        <p class="flex-1 text-right text-sm text-muted">{{ stepProblem }}</p>
        <UButton v-if="step < 3" label="Next" trailing-icon="i-lucide-arrow-right" :disabled="!!stepProblem" @click="step++" />
        <UButton
          v-else
          :label="`Confirm & schedule ${sortedRows.length} ${sortedRows.length === 1 ? 'post' : 'posts'}`"
          icon="i-lucide-calendar-check"
          :loading="confirming"
          :disabled="!sortedRows.length || !!plan.error"
          @click="confirm"
        />
      </div>
    </div>
  </PageShell>
</template>
