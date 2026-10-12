<script setup lang="ts">
import { splitLinks, UPLOAD_EXTENSIONS } from '@clipstudio/core/shared'

const emit = defineEmits<{ links: [links: string[]]; files: [files: File[]] }>()

const text = ref('')
const links = computed(() => splitLinks(text.value))
const fileInput = ref<HTMLInputElement>()
const accept = UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(',')

function submitLinks() {
  if (!links.value.length) return
  emit('links', links.value)
  text.value = ''
}

// Dropped files are handled for the whole app by GlobalDropZone.
function pickFiles(list: FileList | null | undefined) {
  const files = Array.from(list ?? [])
  if (files.length) emit('files', files)
}
</script>

<template>
  <UCard>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
      <UTextarea
        v-model="text"
        :rows="1"
        :maxrows="6"
        autoresize
        size="lg"
        icon="i-lucide-youtube"
        placeholder="Paste YouTube links, one or more"
        class="flex-1"
        @keydown.enter.exact.prevent="submitLinks"
      />
      <div class="flex gap-2">
        <UButton
          :label="links.length > 1 ? `Check ${links.length} links` : 'Check link'"
          icon="i-lucide-search"
          size="lg"
          :disabled="!links.length"
          @click="submitLinks"
        />
        <UButton label="Upload files" icon="i-lucide-upload" color="neutral" variant="outline" size="lg" @click="fileInput?.click()" />
      </div>
    </div>
    <p class="mt-2 text-xs text-muted">
      Or drop video files anywhere on this page ({{ UPLOAD_EXTENSIONS.join(', ') }}). Nothing downloads or uploads until you confirm.
    </p>
    <input
      ref="fileInput"
      type="file"
      multiple
      :accept="accept"
      class="hidden"
      @change="pickFiles(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''"
    />
  </UCard>
</template>
