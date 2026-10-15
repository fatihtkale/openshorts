<script setup lang="ts">
import {
  INSIGHTS_MIN_POSTS,
  PLATFORM_LABELS,
  computeInsights,
  earlyViews,
  formatInZone,
  latestReading,
  parseClock,
  zoneLabel,
  type InsightPost,
  type ScheduleDefaults,
} from '@clipstudio/core/shared'

const toast = useToast()
const { data, refresh } = await useFetch<{ posts: InsightPost[] }>('/api/insights', { default: () => ({ posts: [] }) })
const { data: defaults, refresh: refreshDefaults } = await useFetch<ScheduleDefaults>('/api/settings/schedule')
onJobStatusChange((job) => {
  if (job.type === 'post.stats' || job.type === 'post.publish') void refresh()
})

// ── Check views now (instead of waiting for the 2- and 7-day checks) ─
const { jobs } = useJobs()
const now = useNow(5_000)
/** View checks running now, or due now (queued but not waiting for a later time). */
const checking = computed(() => jobs.value.filter((j) => j.type === 'post.stats' && (j.status === 'running' || (j.status === 'queued' && j.runAt <= now.value))).length)
const requesting = ref(false)
async function checkNow() {
  requesting.value = true
  try {
    const { queued, recent } = await $fetch<{ queued: number; recent: number }>('/api/insights/refresh', { method: 'POST' })
    toast.add({
      title: queued ? `Checking views on ${queued} ${queued === 1 ? 'post' : 'posts'}` : 'Nothing to check right now',
      description: queued
        ? 'The numbers update here as they come in.'
        : recent
          ? 'Every live post was checked in the last 10 minutes.'
          : 'No post is live yet; scheduled videos are checked once they go public.',
      icon: 'i-lucide-refresh-cw',
    })
  } catch (e) {
    toast.add({ title: 'Could not check views', description: (e as { statusMessage?: string }).statusMessage ?? (e as Error).message, color: 'error' })
  } finally {
    requesting.value = false
  }
}

// One filter row scopes every number on the page.
const platform = ref<'all' | 'youtube' | 'tiktok'>('all')
// Only platforms that have posts get a tab; with one platform there's nothing to filter.
const platformItems = computed(() => {
  const used = new Set(data.value.posts.map((p) => p.platform))
  return [
    { label: 'All', value: 'all' },
    ...(used.has('youtube') ? [{ label: 'YouTube', value: 'youtube' }] : []),
    ...(used.has('tiktok') ? [{ label: 'TikTok', value: 'tiktok' }] : []),
  ]
})
const posts = computed(() => data.value.posts.filter((p) => platform.value === 'all' || p.platform === platform.value))
const insights = computed(() => (defaults.value ? computeInsights(posts.value, defaults.value) : null))
const zone = computed(() => (defaults.value ? zoneLabel(Date.now(), defaults.value.timeZone) : ''))
const view = ref<'chart' | 'table'>('chart')

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
const pct = (v: number) => `${Math.round(v * 100)}%`
const clock = (h: number) => `${String(h).padStart(2, '0')}:00`

const tiles = computed(() => {
  const i = insights.value
  if (!i) return []
  return [
    { label: 'Posts measured', value: String(i.measured), hint: 'with a two-day view count' },
    { label: 'Median views at two days', value: i.medianEarlyViews === null ? '—' : compact(i.medianEarlyViews), hint: 'per post' },
    { label: 'Total views', value: compact(i.totalViews), hint: 'latest count, all live posts' },
    { label: 'Waiting', value: String(i.waiting), hint: 'live, two-day count not in yet' },
  ]
})

// ── Suggestion → posting defaults (confirmed) ────────────────────────
const applying = ref(false)
async function applySuggestion() {
  const s = insights.value?.suggestion
  if (!s || !defaults.value) return
  applying.value = true
  try {
    await $fetch('/api/settings/schedule', { method: 'PUT', body: { ...defaults.value, windowStart: s.start, windowEnd: s.end } })
    await refreshDefaults()
    toast.add({ title: `Posting window is now ${s.start}–${s.end}`, description: 'The scheduler starts from it next time.', icon: 'i-lucide-check' })
  } catch (e) {
    toast.add({ title: 'Could not save', description: (e as Error).message, color: 'error' })
  } finally {
    applying.value = false
  }
}

const rows = computed(() =>
  posts.value.slice(0, 50).map((p) => ({
    ...p,
    early: earlyViews(p.readings),
    latest: latestReading(p.readings),
  })),
)
const when = (ms: number) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <PageShell title="Insights">
    <template #actions>
      <UButton
        :label="checking ? `Checking ${checking}…` : 'Check views now'"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :loading="requesting || checking > 0"
        @click="checkNow"
      />
    </template>
    <div class="mx-auto w-full max-w-5xl space-y-6">
      <div class="flex flex-wrap items-center gap-3">
        <UTabs v-if="platformItems.length > 2" v-model="platform" :items="platformItems" :content="false" size="sm" class="w-auto" />
        <p class="text-xs text-muted">Views are read 2 days and 7 days after a post goes live, or whenever you press <strong>Check views now</strong>.</p>
      </div>

      <UCard v-if="!data.posts.length">
        <div class="flex flex-col items-center gap-3 py-10 text-center">
          <UIcon name="i-lucide-chart-column" class="size-10 text-muted" />
          <p class="font-medium">No views to show yet</p>
          <p class="max-w-md text-sm text-muted">
            Once posts are live, the app reads their views after 2 and 7 days and learns which hours work best for you. Until then the
            scheduler uses the US defaults.
          </p>
          <UButton label="Schedule posts" icon="i-lucide-calendar-plus" to="/schedule" />
        </div>
      </UCard>

      <template v-else-if="insights && defaults">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div v-for="t in tiles" :key="t.label" class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">{{ t.label }}</p>
            <p class="mt-1 text-2xl font-semibold text-highlighted">{{ t.value }}</p>
            <p class="text-xs text-dimmed">{{ t.hint }}</p>
          </div>
        </div>

        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start gap-3">
              <div class="flex-1">
                <h2 class="font-semibold">When your posts do best</h2>
                <p class="text-sm text-muted">
                  Views two days in, compared with what's usual for each account, by the hour posted ({{ zone }}). 100% is a normal post.
                </p>
              </div>
              <UTabs
                v-model="view"
                :items="[
                  { label: 'Chart', value: 'chart', icon: 'i-lucide-chart-column' },
                  { label: 'Table', value: 'table', icon: 'i-lucide-table' },
                ]"
                :content="false"
                size="xs"
                class="w-auto"
              />
            </div>
          </template>

          <InsightsHourChart
            v-if="view === 'chart'"
            :hours="insights.hours"
            :window-start="parseClock(defaults.windowStart)"
            :window-end="parseClock(defaults.windowEnd)"
            :zone="zone"
          />
          <table v-else class="w-full text-sm">
            <thead class="text-left text-xs text-muted">
              <tr>
                <th class="py-1.5 font-medium">Hour ({{ zone }})</th>
                <th class="py-1.5 text-right font-medium">Posts</th>
                <th class="py-1.5 text-right font-medium">Views vs usual</th>
                <th class="py-1.5 text-right font-medium">Median views</th>
              </tr>
            </thead>
            <tbody class="tabular-nums">
              <tr v-for="h in insights.hours.filter((x) => x.posts)" :key="h.hour" class="border-t border-default">
                <td class="py-1.5">{{ clock(h.hour) }}–{{ clock((h.hour + 1) % 24) }}</td>
                <td class="py-1.5 text-right">{{ h.posts }}</td>
                <td class="py-1.5 text-right">{{ pct(h.score!) }}</td>
                <td class="py-1.5 text-right">{{ Math.round(h.medianViews ?? 0).toLocaleString() }}</td>
              </tr>
              <tr v-if="!insights.hours.some((x) => x.posts)">
                <td colspan="4" class="py-4 text-center text-muted">No two-day counts yet.</td>
              </tr>
            </tbody>
          </table>

          <template #footer>
            <div v-if="insights.suggestion" class="flex flex-wrap items-center gap-3">
              <UIcon name="i-lucide-lightbulb" class="size-5 shrink-0 text-primary" />
              <p class="flex-1 text-sm">
                Posts between <span class="font-semibold">{{ insights.suggestion.start }}–{{ insights.suggestion.end }} {{ zone }}</span>{{ ' ' }}
                <template v-if="insights.suggestion.lift">got {{ (1 + insights.suggestion.lift).toFixed(1) }}× the views of</template>
                <template v-else>did best; there's too little data yet to judge</template>
                your current window ({{ defaults.windowStart }}–{{ defaults.windowEnd }}), across {{ insights.suggestion.posts }} posts.
              </p>
              <ConfirmButton
                :label="`Use ${insights.suggestion.start}–${insights.suggestion.end}`"
                confirm-label="Yes, change my posting window"
                color="primary"
                size="sm"
                :loading="applying"
                @confirm="applySuggestion"
              />
            </div>
            <p v-else-if="!insights.enough" class="flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-lucide-hourglass" class="size-4 shrink-0" />
              {{ INSIGHTS_MIN_POSTS - insights.measured }} more measured {{ INSIGHTS_MIN_POSTS - insights.measured === 1 ? 'post' : 'posts' }}
              before suggesting times; fewer than {{ INSIGHTS_MIN_POSTS }} is mostly luck.
            </p>
            <p v-else class="flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-lucide-check" class="size-4 shrink-0" />
              Your posting window ({{ defaults.windowStart }}–{{ defaults.windowEnd }} {{ zone }}) is doing as well as any other.
            </p>
          </template>
        </UCard>

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h2 class="font-semibold">Recent posts</h2>
          </template>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-muted">
                <tr>
                  <th class="px-4 py-2 font-medium">Clip</th>
                  <th class="px-4 py-2 font-medium">Went live</th>
                  <th class="px-4 py-2 text-right font-medium">At 2 days</th>
                  <th class="px-4 py-2 text-right font-medium">Now</th>
                  <th class="px-4 py-2 text-right font-medium">Likes</th>
                  <th class="px-4 py-2" />
                </tr>
              </thead>
              <tbody class="tabular-nums">
                <tr v-for="p in rows" :key="p.id" class="border-t border-default">
                  <td class="px-4 py-2">
                    <div class="flex items-center gap-2">
                      <UIcon :name="p.platform === 'youtube' ? 'i-simple-icons-youtube' : 'i-simple-icons-tiktok'" class="size-3.5 shrink-0" />
                      <span class="line-clamp-1">{{ p.title }}</span>
                    </div>
                    <p class="text-xs text-muted">{{ p.accountName ?? `${PLATFORM_LABELS[p.platform]} (disconnected)` }}</p>
                  </td>
                  <td class="px-4 py-2 whitespace-nowrap">
                    {{ when(p.liveAt) }}
                    <span class="block text-xs text-muted">{{ formatInZone(p.liveAt, defaults.timeZone) }} {{ zone }}</span>
                  </td>
                  <td class="px-4 py-2 text-right">{{ p.early === null ? '—' : p.early.toLocaleString() }}</td>
                  <td class="px-4 py-2 text-right">{{ p.latest ? p.latest.views.toLocaleString() : '—' }}</td>
                  <td class="px-4 py-2 text-right">{{ p.latest?.likes == null ? '—' : p.latest.likes.toLocaleString() }}</td>
                  <td class="px-4 py-2 text-right">
                    <UButton v-if="p.url" icon="i-lucide-external-link" color="neutral" variant="ghost" size="xs" :to="p.url" target="_blank" aria-label="Open post" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </template>
    </div>
  </PageShell>
</template>
