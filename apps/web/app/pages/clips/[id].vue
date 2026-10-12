<script setup lang="ts">
import { formatTimecode } from '@clipstudio/core/shared'

const route = useRoute()
const editor = useClipEditor(() => String(route.params.id))
const { data, draft, saveState, error } = editor

const tab = ref<'captions' | 'layout' | 'hook' | 'trim' | 'export'>('captions')
const time = ref(0)
const playing = ref(false)
const safeZones = ref(false)
const exportOpen = ref(false)
const canvasRef = ref<{ seek: (ms: number) => void; video: HTMLVideoElement | undefined } | null>(null)

const title = computed({
  get: () => draft.value?.title ?? '',
  set: (v: string) => editor.update((d) => (d.title = v), 'title'),
})

function seek(ms: number) {
  canvasRef.value?.seek(ms)
}

const saveLabel = computed(
  () => ({ saved: 'Saved', unsaved: 'Unsaved', saving: 'Saving…', error: 'Not saved', conflict: 'Changed elsewhere' })[saveState.value],
)

function onKey(e: KeyboardEvent) {
  const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key.toLowerCase() === 'z') {
    if (typing) return
    e.preventDefault()
    if (e.shiftKey) editor.redo()
    else editor.undo()
    return
  }
  if (typing || mod || e.altKey) return
  if (e.key === ' ') {
    e.preventDefault()
    playing.value = !playing.value
  } else if (e.key.toLowerCase() === 's') {
    safeZones.value = !safeZones.value
  } else if (e.key === 'ArrowLeft') {
    seek(time.value - 1000)
  } else if (e.key === 'ArrowRight') {
    seek(time.value + 1000)
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const tabs = [
  { label: 'Captions', value: 'captions', icon: 'i-lucide-captions' },
  { label: 'Layout', value: 'layout', icon: 'i-lucide-crop' },
  { label: 'Hook', value: 'hook', icon: 'i-lucide-megaphone' },
  { label: 'Trim', value: 'trim', icon: 'i-lucide-scissors' },
  { label: 'Export', value: 'export', icon: 'i-lucide-film' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar>
        <template #left>
          <UButton
            v-if="data"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="`/projects/${data.project.id}`"
            :aria-label="`Back to ${data.project.name}`"
          />
          <input
            v-if="draft"
            v-model="title"
            class="min-w-0 flex-1 truncate rounded bg-transparent px-1 font-semibold outline-none focus:bg-elevated"
            aria-label="Clip title"
          />
        </template>
        <template #right>
          <span class="hidden text-xs sm:inline" :class="saveState === 'error' || saveState === 'conflict' ? 'text-error' : 'text-muted'">{{ saveLabel }}</span>
          <UTooltip text="Undo (⌘Z)">
            <UButton icon="i-lucide-undo-2" color="neutral" variant="ghost" :disabled="!editor.canUndo.value" aria-label="Undo" @click="editor.undo()" />
          </UTooltip>
          <UTooltip text="Redo (⇧⌘Z)">
            <UButton icon="i-lucide-redo-2" color="neutral" variant="ghost" :disabled="!editor.canRedo.value" aria-label="Redo" @click="editor.redo()" />
          </UTooltip>
          <UButton label="Export" icon="i-lucide-film" :disabled="!draft" @click="tab = 'export'; exportOpen = true" />
          <ActivityTray />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty
        v-if="error"
        icon="i-lucide-search-x"
        title="Clip not found"
        description="It may have been removed with its project."
        :actions="[{ label: 'Back to Projects', to: '/' }]"
        class="py-16"
      />

      <div v-else-if="draft && data" class="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <!-- Preview -->
        <div class="flex flex-col items-center gap-3 lg:sticky lg:top-0 lg:h-[calc(100dvh-7.5rem)]">
          <EditorClipCanvas
            ref="canvasRef"
            v-model:time="time"
            v-model:playing="playing"
            :editor="editor"
            :safe-zones="safeZones"
            class="h-[70vh] lg:h-auto lg:min-h-0 lg:flex-1"
          />
          <div class="flex w-full max-w-sm items-center gap-2">
            <UButton
              :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
              color="neutral"
              variant="soft"
              :aria-label="playing ? 'Pause' : 'Play'"
              @click="playing = !playing"
            />
            <USlider :model-value="time" :min="0" :max="Math.max(1, editor.duration.value)" :step="10" size="sm" class="flex-1" @update:model-value="(v) => seek(v as number)" />
            <span class="w-20 text-right text-xs tabular-nums text-muted">
              {{ formatTimecode(time / 1000) }} / {{ formatTimecode(editor.duration.value / 1000) }}
            </span>
            <UTooltip text="Show where app buttons sit (S)">
              <UButton icon="i-lucide-shield-alert" :color="safeZones ? 'primary' : 'neutral'" variant="ghost" aria-label="Safe zones" @click="safeZones = !safeZones" />
            </UTooltip>
          </div>
          <p class="text-xs text-dimmed">Space play · ← → 1 s · S safe zones · ⌘Z undo</p>
        </div>

        <!-- Panels -->
        <UCard :ui="{ body: 'p-4 sm:p-5' }" class="min-w-0">
          <template #header>
            <UTabs v-model="tab" :items="tabs" :content="false" variant="link" size="sm" class="w-full" />
          </template>
          <EditorCaptionsPanel v-if="tab === 'captions'" :editor="editor" />
          <EditorLayoutPanel v-else-if="tab === 'layout'" :editor="editor" :video="canvasRef?.video" :time="time" @seek="seek" />
          <EditorHookPanel v-else-if="tab === 'hook'" :editor="editor" @seek="seek" />
          <EditorTrimPanel v-else-if="tab === 'trim'" :editor="editor" />
          <EditorExportPanel v-else v-model:confirm-open="exportOpen" :editor="editor" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
