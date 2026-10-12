<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ProjectDto } from '@clipstudio/core/shared'

const props = defineProps<{ project: ProjectDto }>()
const emit = defineEmits<{ rename: []; trash: [] }>()

const { activeFor } = useJobs()
const { uploads } = useUploads()

const activity = computed(() => describeProject(props.project, activeFor(props.project.id), uploads.value[props.project.id]))
const thumb = computed(() => thumbnailUrl(props.project))

const menu = computed<DropdownMenuItem[]>(() => [
  { label: 'Open', icon: 'i-lucide-arrow-up-right', to: `/projects/${props.project.id}` },
  { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => emit('rename') },
  { type: 'separator' },
  { label: 'Move to Trash', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('trash') },
])
</script>

<template>
  <div class="group relative overflow-hidden rounded-lg border border-default bg-default transition hover:border-accented">
    <NuxtLink :to="`/projects/${project.id}`" class="block">
      <div class="relative aspect-video bg-elevated">
        <img v-if="thumb" :src="thumb" alt="" class="size-full object-cover" :class="{ 'opacity-60': activity.busy }" />
        <div v-else class="grid size-full place-items-center">
          <UIcon name="i-lucide-film" class="size-8 text-dimmed" />
        </div>
        <span
          v-if="project.status === 'ready' && project.durationMs"
          class="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums"
        >
          {{ formatDuration(project.durationMs) }}
        </span>
        <UBadge
          v-if="project.sourceType === 'youtube'"
          icon="i-lucide-youtube"
          color="neutral"
          variant="solid"
          size="sm"
          class="absolute top-2 left-2 opacity-80"
        />
      </div>
      <div class="space-y-1.5 p-3 pr-10">
        <p class="truncate text-sm font-medium text-highlighted" :title="project.name">{{ project.name }}</p>
        <UProgress
          v-if="activity.busy"
          :model-value="activity.progress === null ? null : Math.round(activity.progress * 100)"
          size="xs"
        />
        <p
          class="truncate text-xs"
          :class="{
            'text-muted': activity.tone === 'neutral' || activity.tone === 'primary',
            'text-error': activity.tone === 'error',
            'text-warning': activity.tone === 'warning',
          }"
          :title="activity.detail ?? undefined"
        >
          {{ activity.label }}<template v-if="activity.detail && activity.busy"> · {{ activity.detail }}</template>
        </p>
      </div>
    </NuxtLink>
    <UDropdownMenu :items="menu" :content="{ align: 'end' }">
      <UButton
        icon="i-lucide-ellipsis-vertical"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Project actions"
        class="absolute right-1.5 bottom-2.5"
      />
    </UDropdownMenu>
  </div>
</template>
