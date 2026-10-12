<script setup lang="ts">
import { nameFromFilename, UPLOAD_EXTENSIONS } from '@clipstudio/core/shared'

const props = defineProps<{ files: File[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ started: [] }>()
const { upload } = useUploads()

interface Item {
  file: File
  name: string
  supported: boolean
}

const items = ref<Item[]>([])

watch(
  () => [open.value, props.files] as const,
  ([isOpen, files]) => {
    if (!isOpen) return
    items.value = files.map((file) => {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      return { file, name: nameFromFilename(file.name), supported: (UPLOAD_EXTENSIONS as readonly string[]).includes(ext) }
    })
  },
  { immediate: true },
)

const valid = computed(() => items.value.filter((i) => i.supported))
const totalBytes = computed(() => valid.value.reduce((sum, i) => sum + i.file.size, 0))

function remove(item: Item) {
  items.value = items.value.filter((i) => i !== item)
  if (!items.value.length) open.value = false
}

function confirm() {
  // Uploads run in the background; the project cards show their progress.
  const queue = valid.value.map((i) => ({ file: i.file, name: i.name.trim() || nameFromFilename(i.file.name) }))
  const runNext = async () => {
    const next = queue.shift()
    if (!next) return
    try {
      await upload(next.file, next.name)
    } catch {
      // useUploads already told the user.
    }
    await runNext()
  }
  // Two at a time: enough to keep the disk busy without starving the preview.
  void runNext()
  void runNext()
  emit('started')
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Import video files"
    description="Each file becomes its own project. The files are copied into Clip Studio's data folder."
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <ul class="divide-y divide-default">
        <li v-for="item in items" :key="item.file.name + item.file.size" class="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <UIcon
            :name="item.supported ? 'i-lucide-file-video' : 'i-lucide-file-x'"
            class="size-5 shrink-0"
            :class="item.supported ? 'text-muted' : 'text-error'"
          />
          <div class="min-w-0 flex-1">
            <UInput v-if="item.supported" v-model="item.name" aria-label="Project name" class="w-full" />
            <p v-else class="truncate text-sm">{{ item.file.name }}</p>
            <p class="mt-1 truncate text-xs" :class="item.supported ? 'text-muted' : 'text-error'">
              <template v-if="item.supported">{{ item.file.name }} · {{ formatBytes(item.file.size) }}</template>
              <template v-else>Not a supported video type. Use {{ UPLOAD_EXTENSIONS.join(', ') }}.</template>
            </p>
          </div>
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" aria-label="Remove" @click="remove(item)" />
        </li>
      </ul>
    </template>

    <template #footer>
      <div class="flex w-full items-center gap-3">
        <p class="flex-1 text-xs text-muted">Keep this tab open until the uploads finish.</p>
        <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          :label="valid.length > 1 ? `Import ${valid.length} videos (${formatBytes(totalBytes)})` : `Import video (${formatBytes(totalBytes)})`"
          icon="i-lucide-upload"
          :disabled="!valid.length"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
