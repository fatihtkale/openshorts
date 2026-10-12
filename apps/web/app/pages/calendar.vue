<script setup lang="ts">
import { PLATFORM_LABELS, POST_STATUS_LABELS, type CalendarPost } from '@clipstudio/core/shared'

const route = useRoute()
const toast = useToast()
const now = useNow(30_000)

/** Monday 00:00 (this Mac's time) of the week containing `d`. */
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
const start = ref(weekStart(typeof route.query.date === 'string' ? new Date(`${route.query.date}T12:00:00`) : new Date()))
const end = computed(() => {
  const e = new Date(start.value)
  e.setDate(e.getDate() + 7)
  return e
})
const days = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.value)
    d.setDate(d.getDate() + i)
    return d
  }),
)

const { data: posts, refresh } = await useFetch<CalendarPost[]>('/api/posts', {
  query: computed(() => ({ from: start.value.getTime(), to: end.value.getTime() })),
  default: () => [],
})
onJobStatusChange((job) => {
  if (job.type === 'post.publish') void refresh()
})

const when = (p: CalendarPost) => p.scheduledAt ?? p.publishedAt ?? p.createdAt
function postsOn(day: Date) {
  const next = new Date(day)
  next.setDate(next.getDate() + 1)
  return posts.value.filter((p) => when(p) >= day.getTime() && when(p) < next.getTime()).sort((a, b) => when(a) - when(b))
}
const isToday = (d: Date) => d.toDateString() === new Date(now.value).toDateString()
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function shift(weeks: number) {
  const s = new Date(start.value)
  s.setDate(s.getDate() + weeks * 7)
  start.value = s
}

const tone = (p: CalendarPost) =>
  p.status === 'failed' || p.status === 'missed'
    ? 'error'
    : p.status === 'published' || p.status === 'scheduled' || p.status === 'sent_to_inbox'
      ? 'success'
      : p.status === 'cancelled'
        ? 'neutral'
        : 'primary'

const missed = computed(() => posts.value.filter((p) => p.status === 'missed'))

// ── Details & actions ────────────────────────────────────────────────
const selected = ref<CalendarPost | null>(null)
const detailOpen = computed({ get: () => !!selected.value, set: (v) => !v && (selected.value = null) })
const newTime = ref('')
const busy = ref<string | null>(null)
watch(selected, (p) => {
  const t = p?.scheduledAt && p.scheduledAt > Date.now() ? p.scheduledAt : Date.now() + 3_600_000
  const d = new Date(t)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  newTime.value = d.toISOString().slice(0, 16)
})

async function act(kind: 'cancel' | 'now' | 'reschedule') {
  const p = selected.value
  if (!p) return
  busy.value = kind
  try {
    const updated =
      kind === 'cancel'
        ? await $fetch<CalendarPost>(`/api/posts/${p.id}/cancel`, { method: 'POST' })
        : await $fetch<CalendarPost>(`/api/posts/${p.id}/reschedule`, {
            method: 'POST',
            body: { scheduledAt: kind === 'now' ? null : new Date(newTime.value).getTime() },
          })
    toast.add({ title: kind === 'cancel' ? 'Post cancelled' : kind === 'now' ? 'Posting now' : 'Rescheduled', icon: 'i-lucide-check' })
    selected.value = { ...p, ...updated }
    await refresh()
  } catch (e) {
    toast.add({ title: 'That didn’t work', description: (e as Error).message, color: 'error' })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <PageShell title="Calendar">
    <template #actions>
      <UButton label="Schedule posts" icon="i-lucide-calendar-plus" to="/schedule" />
    </template>

    <div class="mx-auto w-full max-w-7xl space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" aria-label="Previous week" @click="shift(-1)" />
        <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" aria-label="Next week" @click="shift(1)" />
        <UButton label="This week" color="neutral" variant="outline" size="sm" @click="start = weekStart(new Date())" />
        <h2 class="ml-2 font-semibold">
          {{ start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }} –
          {{ days[6]!.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }}
        </h2>
        <span class="ml-auto text-xs text-muted">Times in your time zone</span>
      </div>

      <UAlert
        v-if="missed.length"
        color="error"
        variant="subtle"
        icon="i-lucide-alarm-clock-off"
        :title="`${missed.length} ${missed.length === 1 ? 'post' : 'posts'} missed their time`"
        description="The Mac was asleep, so nothing was posted. Open a post to send it now, pick a new time, or skip it."
      />

      <div class="grid gap-3 md:grid-cols-7">
        <div
          v-for="day in days"
          :key="day.toISOString()"
          class="min-h-40 rounded-lg border p-2"
          :class="isToday(day) ? 'border-primary bg-primary/5' : 'border-default'"
        >
          <p class="mb-2 text-xs font-medium" :class="isToday(day) ? 'text-primary' : 'text-muted'">
            {{ day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }}
          </p>
          <div class="space-y-1.5">
            <button
              v-for="p in postsOn(day)"
              :key="p.id"
              type="button"
              class="w-full rounded-md border border-default bg-default p-1.5 text-left text-xs transition hover:border-accented"
              :class="{ 'opacity-50': p.status === 'cancelled' }"
              @click="selected = p"
            >
              <div class="flex items-center gap-1.5">
                <UIcon :name="p.platform === 'youtube' ? 'i-simple-icons-youtube' : 'i-simple-icons-tiktok'" class="size-3 shrink-0" />
                <span class="font-semibold tabular-nums">{{ time(when(p)) }}</span>
                <span
                  class="ml-auto size-2 shrink-0 rounded-full"
                  :class="{
                    'bg-error': tone(p) === 'error',
                    'bg-success': tone(p) === 'success',
                    'bg-primary': tone(p) === 'primary',
                    'bg-neutral-400': tone(p) === 'neutral',
                  }"
                />
              </div>
              <p class="mt-0.5 line-clamp-2">{{ p.clipTitle }}</p>
            </button>
            <p v-if="!postsOn(day).length" class="py-2 text-center text-xs text-dimmed">—</p>
          </div>
        </div>
      </div>
    </div>

    <USlideover v-model:open="detailOpen" :title="selected?.clipTitle" :description="selected ? `${PLATFORM_LABELS[selected.platform]} · ${selected.accountName ?? 'disconnected account'}` : undefined">
      <template #body>
        <div v-if="selected" class="space-y-5 text-sm">
          <div class="flex items-center gap-2">
            <UBadge :label="POST_STATUS_LABELS[selected.status]" :color="tone(selected)" variant="subtle" />
            <span class="text-muted">{{ new Date(when(selected)).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }}</span>
          </div>
          <p v-if="selected.error" class="text-error">{{ selected.error }}</p>
          <div class="space-y-1">
            <p class="text-xs text-muted">{{ selected.platform === 'youtube' ? 'Title' : 'Caption' }}</p>
            <p class="whitespace-pre-wrap">{{ selected.title || '(none)' }}</p>
          </div>
          <div v-if="selected.description" class="space-y-1">
            <p class="text-xs text-muted">Description</p>
            <p class="whitespace-pre-wrap text-muted">{{ selected.description }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton v-if="selected.url" label="Open" icon="i-lucide-external-link" color="neutral" variant="outline" size="sm" :to="selected.url" target="_blank" />
            <UButton label="Open project" icon="i-lucide-folder-open" color="neutral" variant="ghost" size="sm" :to="`/projects/${selected.projectId}`" />
          </div>

          <template v-if="['queued', 'missed', 'failed', 'cancelled'].includes(selected.status)">
            <USeparator />
            <div class="space-y-3">
              <p class="font-medium">{{ selected.status === 'queued' ? 'Change this post' : 'What now?' }}</p>
              <UButton
                v-if="selected.status !== 'queued'"
                label="Post now"
                icon="i-lucide-send"
                size="sm"
                :loading="busy === 'now'"
                @click="act('now')"
              />
              <div class="flex flex-wrap items-end gap-2">
                <UFormField label="New time">
                  <UInput v-model="newTime" type="datetime-local" size="sm" />
                </UFormField>
                <UButton label="Move" color="neutral" variant="outline" size="sm" :loading="busy === 'reschedule'" @click="act('reschedule')" />
              </div>
              <ConfirmButton
                v-if="selected.status !== 'cancelled'"
                :label="selected.status === 'missed' ? 'Skip this post' : 'Cancel this post'"
                confirm-label="Yes, cancel it"
                size="sm"
                @confirm="act('cancel')"
              />
            </div>
          </template>
          <p v-else-if="selected.status === 'scheduled'" class="text-xs text-muted">
            The video is on YouTube as private and goes public at this time, even if the Mac is off. To change it, use YouTube Studio.
          </p>
        </div>
      </template>
    </USlideover>
  </PageShell>
</template>
