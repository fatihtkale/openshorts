<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import {
  groupParagraphs,
  languageName,
  LOW_CONFIDENCE,
  searchWords,
  wordIndexAt,
  formatTimecode,
  type ModelListItem,
  type ProjectDto,
  type TranscriptDto,
} from '@clipstudio/core/shared'

const props = defineProps<{ project: ProjectDto; currentMs: number }>()
const emit = defineEmits<{ seek: [ms: number]; changed: [] }>()
const toast = useToast()
const { activeFor, cancel } = useJobs()

const summary = computed(() => props.project.transcript)
const job = computed(() => {
  const j = activeFor(props.project.id)
  return j?.type === 'transcribe' ? j : undefined
})

// The full transcript is loaded only when one exists, and again whenever it changes.
const { data: transcript, refresh } = await useFetch<TranscriptDto>(() => `/api/projects/${props.project.id}/transcript`, {
  server: false,
  immediate: false,
})
watch(
  () => [summary.value?.updatedAt, summary.value?.wordCount] as const,
  () => {
    if (summary.value && summary.value.wordCount > 0 && summary.value.updatedAt !== transcript.value?.updatedAt) void refresh()
  },
  { immediate: true },
)

const { data: models } = await useFetch<ModelListItem[]>('/api/models', { default: () => [], server: false })
const activeModel = computed(() => models.value.find((m) => m.selected) ?? null)

const words = computed(() => transcript.value?.words ?? [])
const paragraphs = computed(() => groupParagraphs(words.value))

// ── Follow the video ────────────────────────────────────────────────
const follow = ref(true)
const scroller = ref<HTMLElement>()
let currentEl: HTMLElement | null = null

watch(
  () => [props.currentMs, words.value] as const,
  ([ms]) => {
    const i = wordIndexAt(words.value, ms)
    const el = i >= 0 ? scroller.value?.querySelector<HTMLElement>(`[data-i="${i}"]`) ?? null : null
    if (el === currentEl) return
    currentEl?.classList.remove('is-current')
    el?.classList.add('is-current')
    currentEl = el
    if (el && follow.value && scroller.value && !editing.value) {
      const box = scroller.value.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) {
        scroller.value.scrollTo({ top: scroller.value.scrollTop + r.top - box.top - box.height / 3, behavior: 'smooth' })
      }
    }
  },
  { flush: 'post' },
)

// ── Search ──────────────────────────────────────────────────────────
const query = ref('')
const matches = computed(() => (query.value.trim().length >= 2 ? searchWords(words.value, query.value) : []))
const matched = computed(() => {
  const set = new Set<number>()
  for (const m of matches.value) for (let i = m.from; i < m.to; i++) set.add(i)
  return set
})
const matchCursor = ref(0)
watch(matches, () => (matchCursor.value = 0))

function jumpToMatch(step: number) {
  if (!matches.value.length) return
  matchCursor.value = (matchCursor.value + step + matches.value.length) % matches.value.length
  const m = matches.value[matchCursor.value]!
  scroller.value?.querySelector(`[data-i="${m.from}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// ── Editing ─────────────────────────────────────────────────────────
const editing = ref(false)
const pending = ref(new Map<number, string>())
const editIndex = ref<number | null>(null)
const draft = ref('')
const saving = ref(false)

function textAt(i: number) {
  return pending.value.get(i) ?? words.value[i]!.text
}

function onWordClick(i: number) {
  if (!editing.value) return emit('seek', words.value[i]!.start)
  editIndex.value = i
  draft.value = textAt(i)
  nextTick(() => scroller.value?.querySelector<HTMLInputElement>('input[data-edit]')?.select())
}

function commitDraft() {
  const i = editIndex.value
  if (i === null) return
  const text = draft.value.trim()
  const next = new Map(pending.value)
  if (!text || text === words.value[i]!.text) next.delete(i)
  else next.set(i, text)
  pending.value = next
  editIndex.value = null
}

function stopEditing() {
  editing.value = false
  editIndex.value = null
  pending.value = new Map()
}

async function save() {
  if (!transcript.value || !pending.value.size) return
  saving.value = true
  try {
    transcript.value = await $fetch<TranscriptDto>(`/api/projects/${props.project.id}/transcript`, {
      method: 'PATCH',
      body: {
        updatedAt: transcript.value.updatedAt,
        edits: [...pending.value].map(([index, text]) => ({ index, text })),
      },
    })
    toast.add({ title: `Saved ${pending.value.size} ${pending.value.size === 1 ? 'fix' : 'fixes'}`, icon: 'i-lucide-check' })
    stopEditing()
    emit('changed')
  } catch (e) {
    toast.add({ title: 'Could not save', description: (e as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

const lowConfidenceCount = computed(() => words.value.filter((w) => w.p < LOW_CONFIDENCE).length)

// ── Actions ─────────────────────────────────────────────────────────
const transcribeOpen = ref(false)
const menu = computed<DropdownMenuItem[][]>(() => [
  [
    { label: 'Fix words', icon: 'i-lucide-pencil', onSelect: () => (editing.value = true), disabled: !words.value.length },
    { label: 'Transcribe again…', icon: 'i-lucide-rotate-ccw', onSelect: () => (transcribeOpen.value = true), disabled: !!job.value },
  ],
  [
    { label: 'Download subtitles (.srt)', icon: 'i-lucide-download', to: `/api/projects/${props.project.id}/transcript/export?format=srt`, external: true, download: true },
    { label: 'Download text (.txt)', icon: 'i-lucide-file-text', to: `/api/projects/${props.project.id}/transcript/export?format=txt`, external: true, download: true },
  ],
])

function onStarted() {
  emit('changed')
}
</script>

<template>
  <UCard class="flex h-full flex-col" :ui="{ body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0', header: 'p-3 sm:px-4' }">
    <template #header>
      <div class="flex items-center gap-2">
        <h2 class="font-semibold">Transcript</h2>
        <UBadge v-if="transcript?.language" :label="languageName(transcript.language)" color="neutral" variant="subtle" size="sm" />
        <span v-if="transcript?.wordCount" class="text-xs text-muted">{{ transcript.wordCount.toLocaleString() }} words</span>
        <div class="ml-auto flex items-center gap-1">
          <UDropdownMenu v-if="words.length" :items="menu" :content="{ align: 'end' }">
            <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" aria-label="Transcript actions" />
          </UDropdownMenu>
        </div>
      </div>
    </template>

    <!-- Working on it (first time, or again) -->
    <div v-if="job" class="space-y-2 border-b border-default p-4">
      <div class="flex items-center gap-2 text-sm">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-primary" />
        <span class="font-medium">{{ job.status === 'running' ? 'Transcribing' : 'Waiting to transcribe' }}</span>
        <span v-if="job.status === 'running'" class="ml-auto text-xs tabular-nums text-muted">{{ Math.round(job.progress * 100) }}%</span>
      </div>
      <UProgress v-if="job.status === 'running'" :model-value="Math.round(job.progress * 100)" size="xs" />
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-muted">
          {{ words.length ? 'The current transcript stays until the new one is ready.' : 'Usually a few minutes per hour of video.' }}
        </p>
        <ConfirmButton label="Stop" confirm-label="Stop transcribing?" @confirm="cancel(job.id)" />
      </div>
    </div>

    <UAlert
      v-else-if="summary?.status === 'failed'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      title="Transcription didn't finish"
      :description="summary.error ?? undefined"
      :actions="[{ label: 'Try again', icon: 'i-lucide-rotate-ccw', onClick: () => (transcribeOpen = true) }]"
      class="m-3 w-auto"
    />

    <!-- Nothing yet -->
    <div v-if="!words.length && !job" class="grid flex-1 place-items-center p-6">
      <UEmpty
        v-if="project.hasAudio === false"
        icon="i-lucide-volume-x"
        title="No sound"
        description="This video has no audio track, so there's nothing to transcribe."
        variant="naked"
      />
      <UEmpty
        v-else-if="!activeModel"
        icon="i-lucide-audio-lines"
        title="Install a speech model"
        description="Transcription runs on this Mac. Download a Whisper model once, and new videos are transcribed automatically."
        :actions="[{ label: 'Go to System check', icon: 'i-lucide-activity', to: '/system' }]"
        variant="naked"
      />
      <UEmpty
        v-else-if="summary?.status !== 'failed'"
        icon="i-lucide-audio-lines"
        title="Not transcribed yet"
        :description="`Get every word with its timing, using ${activeModel.label}.`"
        :actions="[{ label: 'Transcribe', icon: 'i-lucide-audio-lines', onClick: () => (transcribeOpen = true) }]"
        variant="naked"
      />
    </div>

    <template v-else-if="words.length">
      <!-- Toolbar -->
      <div class="flex flex-wrap items-center gap-2 border-b border-default p-3 sm:px-4">
        <template v-if="!editing">
          <UInput v-model="query" icon="i-lucide-search" placeholder="Search the transcript" size="sm" class="min-w-0 flex-1">
            <template v-if="matches.length" #trailing>
              <span class="text-xs tabular-nums text-muted">{{ matchCursor + 1 }}/{{ matches.length }}</span>
            </template>
          </UInput>
          <UButton icon="i-lucide-chevron-up" color="neutral" variant="ghost" size="sm" :disabled="!matches.length" aria-label="Previous match" @click="jumpToMatch(-1)" />
          <UButton icon="i-lucide-chevron-down" color="neutral" variant="ghost" size="sm" :disabled="!matches.length" aria-label="Next match" @click="jumpToMatch(1)" />
          <USwitch v-model="follow" label="Follow video" size="sm" />
        </template>
        <template v-else>
          <p class="flex-1 text-xs text-muted">
            Click a word to fix it. Enter keeps it, Esc cancels.
            <template v-if="lowConfidenceCount">Dotted words are ones the model wasn't sure about.</template>
          </p>
          <UButton label="Cancel" color="neutral" variant="ghost" size="sm" @click="stopEditing" />
          <UButton
            :label="pending.size ? `Save ${pending.size} ${pending.size === 1 ? 'fix' : 'fixes'}` : 'Save'"
            size="sm"
            :disabled="!pending.size"
            :loading="saving"
            @click="save"
          />
        </template>
      </div>

      <!-- Words -->
      <div ref="scroller" class="transcript min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-[15px] leading-7" :class="{ editing }">
        <p v-for="para in paragraphs" :key="para.from" class="flex gap-3">
          <button
            type="button"
            class="mt-1 h-fit shrink-0 rounded px-1 font-mono text-xs text-muted tabular-nums hover:bg-elevated hover:text-default"
            @click="emit('seek', para.start)"
          >
            {{ formatTimecode(para.start / 1000) }}
          </button>
          <span>
            <template v-for="i in para.to - para.from" :key="para.from + i - 1">
              <input
                v-if="editIndex === para.from + i - 1"
                v-model="draft"
                data-edit
                class="w-28 rounded border border-primary bg-default px-1 text-[15px] outline-none"
                @keydown.enter.prevent="commitDraft"
                @keydown.esc.prevent="editIndex = null"
                @blur="commitDraft"
              />
              <span
                v-else
                :data-i="para.from + i - 1"
                class="word"
                :class="{
                  'is-match': matched.has(para.from + i - 1),
                  'is-unsure': words[para.from + i - 1]!.p < LOW_CONFIDENCE,
                  'is-pending': pending.has(para.from + i - 1),
                }"
                :title="words[para.from + i - 1]!.p < LOW_CONFIDENCE ? 'The model was unsure about this word' : undefined"
                @click="onWordClick(para.from + i - 1)"
              >{{ textAt(para.from + i - 1) }}</span>{{ ' ' }}
            </template>
          </span>
        </p>
      </div>
    </template>

    <TranscribeModal v-model:open="transcribeOpen" :project="project" :model-label="activeModel?.label ?? null" @started="onStarted" />
  </UCard>
</template>

<style scoped>
.transcript :deep(.word) {
  cursor: pointer;
  border-radius: 0.25rem;
  padding: 0 0.05rem;
  transition: background-color 120ms;
}
.transcript :deep(.word:hover) {
  background: var(--ui-bg-elevated);
}
.transcript :deep(.word.is-current) {
  background: color-mix(in oklab, var(--ui-primary) 30%, transparent);
  color: var(--ui-text-highlighted);
}
.transcript :deep(.word.is-match) {
  background: color-mix(in oklab, var(--ui-warning) 35%, transparent);
}
.transcript.editing :deep(.word.is-unsure) {
  text-decoration: underline dotted var(--ui-warning);
  text-underline-offset: 4px;
}
.transcript :deep(.word.is-pending) {
  color: var(--ui-primary);
  font-weight: 500;
}
</style>
