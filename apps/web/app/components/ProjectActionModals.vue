<script setup lang="ts">
import type { ProjectDto } from '@clipstudio/core/shared'

/**
 * Rename and Move-to-Trash dialogs for one project. The parent sets `action` to open one.
 */
const props = defineProps<{ project: ProjectDto | null }>()
const action = defineModel<'rename' | 'trash' | null>('action', { required: true })
const emit = defineEmits<{ changed: [project: ProjectDto] }>()
const toast = useToast()

const name = ref('')
const busy = ref(false)

watch(action, (value) => {
  if (value === 'rename') name.value = props.project?.name ?? ''
})

const renameOpen = computed({
  get: () => action.value === 'rename',
  set: (v) => (action.value = v ? 'rename' : null),
})
const trashOpen = computed({
  get: () => action.value === 'trash',
  set: (v) => (action.value = v ? 'trash' : null),
})

async function submit(kind: 'rename' | 'trash') {
  if (!props.project) return
  busy.value = true
  try {
    const updated =
      kind === 'rename'
        ? await $fetch<ProjectDto>(`/api/projects/${props.project.id}`, { method: 'PATCH', body: { name: name.value } })
        : await $fetch<ProjectDto>(`/api/projects/${props.project.id}`, { method: 'DELETE' })
    if (kind === 'trash') {
      toast.add({ title: 'Moved to Trash', description: updated.name, icon: 'i-lucide-trash-2', actions: [{ label: 'Open Trash', to: '/trash' }] })
    }
    emit('changed', updated)
    action.value = null
  } catch (error) {
    toast.add({ title: kind === 'rename' ? 'Could not rename' : 'Could not move to Trash', description: (error as Error).message, color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="renameOpen" title="Rename project">
    <template #body>
      <form id="rename-project" @submit.prevent="submit('rename')">
        <UInput v-model="name" autofocus class="w-full" aria-label="Project name" />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="action = null" />
        <UButton label="Save" type="submit" form="rename-project" :loading="busy" :disabled="!name.trim()" />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="trashOpen"
    :title="`Move “${project?.name}” to Trash?`"
    description="Any download or processing still running for it stops. You can restore it from the Trash."
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="action = null" />
        <UButton label="Move to Trash" icon="i-lucide-trash-2" color="error" :loading="busy" @click="submit('trash')" />
      </div>
    </template>
  </UModal>
</template>
