<script setup lang="ts">
import { formatInZone, PLATFORM_LABELS, POST_STATUS_LABELS, youtubeStudioUrl, zonedDate, zoneLabel, type CalendarPost, type ScheduleDefaults } from '@clipstudio/core/shared'

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
/** "YYYY-MM-DD" of a calendar date (its own Y/M/D, whatever the zone). */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const days = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.value)
    d.setDate(d.getDate() + i)
    return ymd(d)
  }),
)
const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, opts)

// Which clock the week is shown in: the audience's (posts are planned in it) or this Mac's.
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const { data: defaults } = await useFetch<ScheduleDefaults>('/api/settings/schedule', { server: false })
const audienceZone = computed(() => defaults.value?.timeZone ?? 'America/New_York')
const ZONE_KEY = 'calendar.zone'
const showLocal = ref(false)
onMounted(() => {
  try {
    showLocal.value = localStorage.getItem(ZONE_KEY) === 'local'
  } catch {
    // No storage: audience time.
  }
})
watch(showLocal, (v) => {
  try {
    localStorage.setItem(ZONE_KEY, v ? 'local' : 'audience')
  } catch {
    // Not remembered; fine.
  }
})
const viewZone = computed(() => (showLocal.value ? localZone : audienceZone.value))
const otherZone = computed(() => (showLocal.value ? audienceZone.value : localZone))
const sameZone = computed(() => localZone === audienceZone.value)
const cityName = (zone: string) => zone.split('/').pop()!.replace(/_/g, ' ')

// A day either side, so posts near midnight in the other zone are there too.
const { data: posts, refresh } = await useFetch<CalendarPost[]>('/api/posts', {
  query: computed(() => ({ from: start.value.getTime() - 86_400_000, to: end.value.getTime() + 86_400_000 })),
  default: () => [],
})
onJobStatusChange((job) => {
  if (job.type === 'post.publish') void refresh()
})

const when = (p: CalendarPost) => p.scheduledAt ?? p.publishedAt ?? p.createdAt
function postsOn(day: string) {
  return posts.value.filter((p) => zonedDate(when(p), viewZone.value) === day).sort((a, b) => when(a) - when(b))
}
const isToday = (day: string) => day === zonedDate(now.value, viewZone.value)
const time = (ms: number, zone = viewZone.value) => formatInZone(ms, zone)
/** The other clock, with "+1"/"−1" when it falls on another day. */
function otherTime(ms: number): string {
  const shift = Math.round((Date.parse(zonedDate(ms, otherZone.value)) - Date.parse(zonedDate(ms, viewZone.value))) / 86_400_000)
  return `${time(ms, otherZone.value)}${shift > 0 ? ' +1' : shift < 0 ? ' −1' : ''}`
}

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

// ── Editing the text ─────────────────────────────────────────────────
const editingText = ref(false)
const draft = reactive({ title: '', description: '', tags: '', relatedVideo: '' })
const savingText = ref(false)
const textError = ref<string | null>(null)
watch(selected, () => {
  editingText.value = false
  textError.value = null
})
/** Waiting posts change only here; videos already on YouTube are updated there too. TikTok can't be edited once up. */
const editWhere = computed<'local' | 'youtube' | null>(() => {
  const p = selected.value
  if (!p) return null
  if (['queued', 'failed', 'missed', 'cancelled'].includes(p.status)) return 'local'
  if (p.platform === 'youtube' && p.remoteId && (p.status === 'scheduled' || p.status === 'published')) return 'youtube'
  return null
})
function startEdit() {
  const p = selected.value!
  Object.assign(draft, { title: p.title, description: p.description, tags: (p.youtube?.tags ?? []).join(', '), relatedVideo: p.youtube?.relatedVideo ?? '' })
  textError.value = null
  editingText.value = true
}
async function saveText() {
  const p = selected.value!
  savingText.value = true
  textError.value = null
  try {
    const updated = await $fetch<CalendarPost>(`/api/posts/${p.id}`, {
      method: 'PATCH',
      body: {
        title: draft.title,
        description: draft.description,
        tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
        relatedVideo: draft.relatedVideo.trim() || null,
      },
    })
    selected.value = { ...p, ...updated }
    editingText.value = false
    toast.add({ title: editWhere.value === 'youtube' ? 'Updated on YouTube' : 'Text saved', icon: 'i-lucide-check' })
    await refresh()
  } catch (e) {
    textError.value = (e as { statusMessage?: string }).statusMessage ?? (e as Error).message
  } finally {
    savingText.value = false
  }
}

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
    toast.add({ title: 'That didn’t work', description: (e as { statusMessage?: string }).statusMessage ?? (e as Error).message, color: 'error' })
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
          {{ dayLabel(days[6]!, { day: 'numeric', month: 'short', year: 'numeric' }) }}
        </h2>
        <div v-if="!sameZone" class="ml-auto flex items-center gap-2 text-xs">
          <span class="text-muted">Times in</span>
          <UButton
            :label="`${cityName(audienceZone)} (audience)`"
            size="xs"
            :color="showLocal ? 'neutral' : 'primary'"
            :variant="showLocal ? 'ghost' : 'soft'"
            @click="showLocal = false"
          />
          <UButton :label="`${cityName(localZone)} (you)`" size="xs" :color="showLocal ? 'primary' : 'neutral'" :variant="showLocal ? 'soft' : 'ghost'" @click="showLocal = true" />
        </div>
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
          :key="day"
          class="min-h-40 rounded-lg border p-2"
          :class="isToday(day) ? 'border-primary bg-primary/5' : 'border-default'"
        >
          <p class="mb-2 text-xs font-medium" :class="isToday(day) ? 'text-primary' : 'text-muted'">
            {{ dayLabel(day, { weekday: 'short', day: 'numeric' }) }}
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
                <span v-if="!sameZone" class="text-dimmed tabular-nums" :title="`${cityName(otherZone)} time`">{{ otherTime(when(p)) }}</span>
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
              <p class="mt-0.5 line-clamp-2">{{ p.title || p.clipTitle }}</p>
            </button>
            <p v-if="!postsOn(day).length" class="py-2 text-center text-xs text-dimmed">—</p>
          </div>
        </div>
      </div>
    </div>

    <USlideover v-model:open="detailOpen" :title="selected ? selected.title || selected.clipTitle : undefined" :description="selected ? `${PLATFORM_LABELS[selected.platform]} · ${selected.accountName ?? 'disconnected account'}` : undefined">
      <template #body>
        <div v-if="selected" class="space-y-5 text-sm">
          <div class="flex items-center gap-2">
            <UBadge :label="POST_STATUS_LABELS[selected.status]" :color="tone(selected)" variant="subtle" />
            <span class="text-muted">
              {{ formatInZone(when(selected), audienceZone, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }}
              {{ zoneLabel(when(selected), audienceZone) }}
              <template v-if="!sameZone">· {{ formatInZone(when(selected), localZone, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }} your time</template>
            </span>
          </div>
          <p v-if="selected.error" class="text-error">{{ selected.error }}</p>
          <template v-if="!editingText">
            <div class="space-y-1">
              <p class="text-xs text-muted">{{ selected.platform === 'youtube' ? 'Title' : 'Caption' }}</p>
              <p class="whitespace-pre-wrap">{{ selected.title || '(none)' }}</p>
            </div>
            <div v-if="selected.description" class="space-y-1">
              <p class="text-xs text-muted">Description</p>
              <p class="whitespace-pre-wrap text-muted">{{ selected.description }}</p>
            </div>
            <div v-if="selected.youtube?.tags.length" class="space-y-1">
              <p class="text-xs text-muted">Tags</p>
              <p class="text-muted">{{ selected.youtube.tags.join(', ') }}</p>
            </div>
            <UButton v-if="editWhere" label="Edit text" icon="i-lucide-pencil" color="neutral" variant="outline" size="sm" @click="startEdit" />
          </template>
          <div v-else class="space-y-3">
            <UFormField :label="selected.platform === 'youtube' ? 'Title' : 'Caption'">
              <UTextarea v-model="draft.title" :rows="2" autoresize class="w-full" />
            </UFormField>
            <template v-if="selected.platform === 'youtube'">
              <UFormField label="Description" help="Hashtags go here; the first 3 show above the title.">
                <UTextarea v-model="draft.description" :rows="4" autoresize class="w-full" />
              </UFormField>
              <UFormField label="Tags" help="Search keywords, separated by commas. Not shown to viewers.">
                <UInput v-model="draft.tags" class="w-full" />
              </UFormField>
              <UFormField label="Related video (reminder)">
                <UInput v-model="draft.relatedVideo" placeholder="Title or link of the video to link in YouTube Studio" class="w-full" />
              </UFormField>
            </template>
            <UAlert
              v-if="textError"
              color="error"
              variant="subtle"
              :description="textError"
              :actions="textError.includes('Accounts') ? [{ label: 'Go to Accounts', to: '/accounts', size: 'xs' }] : undefined"
            />
            <div class="flex gap-2">
              <UButton
                :label="editWhere === 'youtube' ? 'Save and update on YouTube' : 'Save'"
                icon="i-lucide-check"
                size="sm"
                :loading="savingText"
                @click="saveText"
              />
              <UButton label="Cancel" color="neutral" variant="ghost" size="sm" @click="editingText = false" />
            </div>
          </div>

          <div v-if="selected.platform === 'youtube' && selected.remoteId" class="space-y-2 rounded-md border border-default p-3">
            <p v-if="selected.youtube?.relatedVideo" class="text-sm">
              <span class="text-muted">Related video to set:</span> {{ selected.youtube.relatedVideo }}
            </p>
            <p class="text-xs text-muted">
              Related video, end screens and anything else YouTube's API can't set are done in YouTube Studio. It stays scheduled.
            </p>
            <UButton
              label="Open in YouTube Studio"
              icon="i-lucide-external-link"
              color="neutral"
              variant="outline"
              size="sm"
              :to="youtubeStudioUrl(selected.remoteId)"
              target="_blank"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton v-if="selected.url" label="Open" icon="i-lucide-external-link" color="neutral" variant="outline" size="sm" :to="selected.url" target="_blank" />
            <UButton label="Open project" icon="i-lucide-folder-open" color="neutral" variant="ghost" size="sm" :to="`/projects/${selected.projectId}`" />
          </div>

          <template v-if="selected.platform === 'youtube' && selected.status === 'scheduled' && selected.remoteId && (selected.scheduledAt ?? 0) > now">
            <USeparator />
            <div class="space-y-2">
              <p class="font-medium">Move the publish time</p>
              <p class="text-xs text-muted">The video is already on YouTube; the new time is changed there too.</p>
              <div class="flex flex-wrap items-end gap-2">
                <UFormField :label="sameZone ? 'New time' : `New time (${cityName(localZone)} time)`">
                  <UInput v-model="newTime" type="datetime-local" size="sm" />
                </UFormField>
                <UButton label="Move on YouTube" color="neutral" variant="outline" size="sm" :loading="busy === 'reschedule'" @click="act('reschedule')" />
              </div>
            </div>
          </template>

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
                <UFormField :label="sameZone ? 'New time' : `New time (${cityName(localZone)} time)`">
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
            The video is on YouTube as private and goes public at this time, even if the Mac is off. Edit its text above; for anything else, open YouTube Studio.
          </p>
        </div>
      </template>
    </USlideover>
  </PageShell>
</template>
