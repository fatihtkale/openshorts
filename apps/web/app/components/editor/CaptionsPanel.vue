<script setup lang="ts">
import { CAPTION_FONTS, CAPTION_PRESETS, normaliseWord, type CaptionStyle } from '@clipstudio/captions'
import type { ClipEditor } from '~/composables/useClipEditor'

const props = defineProps<{ editor: ClipEditor }>()
const captions = computed(() => props.editor.draft.value!.edit.captions)
const style = computed(() => captions.value.style)

/** Two-way binding for one style field; slider drags merge into one undo step. */
function field<K extends keyof CaptionStyle>(key: K) {
  return computed<CaptionStyle[K]>({
    get: () => style.value[key],
    set: (v) => props.editor.update((d) => (d.edit.captions.style[key] = v), `caption-${String(key)}`),
  })
}

const enabled = computed({
  get: () => captions.value.enabled,
  set: (v: boolean) => props.editor.update((d) => (d.edit.captions.enabled = v)),
})
const fontFamily = field('fontFamily')
const fontWeight = field('fontWeight')
const fontSize = field('fontSize')
const uppercase = field('uppercase')
const textColor = field('textColor')
const activeColor = field('activeColor')
const keywordColor = field('keywordColor')
const strokeColor = field('strokeColor')
const strokeWidth = field('strokeWidth')
const shadow = field('shadow')
const boxColor = field('boxColor')
const y = field('y')
const maxWordsPerLine = field('maxWordsPerLine')
const maxLines = field('maxLines')

function applyPreset(id: string) {
  const preset = CAPTION_PRESETS.find((p) => p.id === id)!
  // Keep where the captions sit; everything else comes from the preset.
  props.editor.update((d) => {
    d.edit.captions.preset = id
    d.edit.captions.style = { ...preset.style, y: d.edit.captions.style.y }
    d.edit.captions.enabled = true
  })
}

const fontItems = CAPTION_FONTS.map((f) => ({ label: f.label, value: f.family }))
const weightItems = computed(() =>
  (CAPTION_FONTS.find((f) => f.family === fontFamily.value)?.weights ?? [400]).map((w) => ({ label: String(w), value: w })),
)
watch(fontFamily, (family) => {
  const weights = CAPTION_FONTS.find((f) => f.family === family)?.weights ?? []
  if (weights.length && !weights.includes(fontWeight.value)) fontWeight.value = weights.at(-1)!
})

// ── Emoji for the emoji preset ──────────────────────────────────────
const emojis = computed(() => Object.entries(props.editor.draft.value!.edit.emojis))
const newWord = ref('')
const newEmoji = ref('')
function addEmoji() {
  const word = normaliseWord(newWord.value)
  const emoji = newEmoji.value.trim()
  if (!word || !emoji) return
  props.editor.update((d) => (d.edit.emojis[word] = emoji))
  newWord.value = ''
  newEmoji.value = ''
}
function removeEmoji(word: string) {
  props.editor.update((d) => delete d.edit.emojis[word])
}
</script>

<template>
  <div class="space-y-6">
    <USwitch v-model="enabled" label="Show captions" />

    <div class="grid grid-cols-3 gap-2">
      <button
        v-for="preset in CAPTION_PRESETS"
        :key="preset.id"
        type="button"
        class="rounded-lg border p-1.5 text-left transition hover:border-accented"
        :class="captions.preset === preset.id ? 'border-primary ring-2 ring-primary/40' : 'border-default'"
        @click="applyPreset(preset.id)"
      >
        <EditorPresetThumb :caption-style="captions.preset === preset.id ? style : preset.style" />
        <p class="mt-1.5 truncate px-0.5 text-xs font-medium">{{ preset.label }}</p>
      </button>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Font">
        <USelect v-model="fontFamily" :items="fontItems" value-key="value" class="w-full" />
      </UFormField>
      <UFormField label="Weight">
        <USelect v-model="fontWeight" :items="weightItems" value-key="value" class="w-full" />
      </UFormField>
    </div>

    <UFormField :label="`Size · ${Math.round(fontSize)}`">
      <USlider v-model="fontSize" :min="36" :max="200" />
    </UFormField>
    <UFormField :label="`Position · ${Math.round(y * 100)}% from the top`" help="Keep clear of the red zones (press S to show them).">
      <USlider v-model="y" :min="0.08" :max="0.92" :step="0.005" />
    </UFormField>
    <div class="grid grid-cols-2 gap-3">
      <UFormField :label="`Words per line · ${maxWordsPerLine}`">
        <USlider v-model="maxWordsPerLine" :min="1" :max="8" />
      </UFormField>
      <UFormField :label="`Lines · ${maxLines}`">
        <USlider v-model="maxLines" :min="1" :max="3" />
      </UFormField>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <EditorColorField v-model="textColor" label="Text" />
      <EditorColorField v-model="activeColor" label="Spoken word" />
      <EditorColorField v-model="keywordColor" label="Keywords" />
      <EditorColorField v-model="boxColor" label="Box" />
      <EditorColorField v-model="strokeColor" label="Outline" />
    </div>
    <UFormField :label="`Outline · ${strokeWidth}`">
      <USlider v-model="strokeWidth" :min="0" :max="30" />
    </UFormField>
    <div class="flex flex-wrap gap-6">
      <USwitch v-model="uppercase" label="Capitals" />
      <USwitch v-model="shadow" label="Shadow" />
    </div>

    <div v-if="style.animation === 'emoji'" class="space-y-2">
      <p class="text-sm font-medium">Emoji</p>
      <p class="text-xs text-muted">Shown above a word when it's spoken.</p>
      <div v-for="[word, emoji] in emojis" :key="word" class="flex items-center gap-2 text-sm">
        <span class="text-lg">{{ emoji }}</span>
        <span class="flex-1">{{ word }}</span>
        <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" aria-label="Remove emoji" @click="removeEmoji(word)" />
      </div>
      <form class="flex gap-2" @submit.prevent="addEmoji">
        <UInput v-model="newWord" placeholder="Word" size="sm" class="flex-1" />
        <UInput v-model="newEmoji" placeholder="🔥" size="sm" class="w-16" />
        <UButton label="Add" size="sm" type="submit" color="neutral" variant="outline" :disabled="!newWord.trim() || !newEmoji.trim()" />
      </form>
    </div>
  </div>
</template>
