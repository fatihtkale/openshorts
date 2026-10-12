<script setup lang="ts">
import type { ProjectDto } from '@clipstudio/core/shared'

const { data: projects, refresh } = await useFetch<ProjectDto[]>('/api/projects', { default: () => [] })

// Refresh when an import job for a project changes state (download done → preparing → ready).
onJobStatusChange((job) => {
  if (job.projectId) void refresh()
})

const pendingLinks = ref<string[]>([])
const youtubeOpen = ref(false)
const pendingFiles = ref<File[]>([])
const uploadOpen = ref(false)

function onLinks(links: string[]) {
  pendingLinks.value = links
  youtubeOpen.value = true
}
function onFiles(files: File[]) {
  pendingFiles.value = files
  uploadOpen.value = true
}

// Files dropped on any page land here.
const dropped = useDroppedFiles()
watch(
  dropped,
  (files) => {
    if (!files.length) return
    onFiles(files)
    dropped.value = []
  },
  { immediate: true },
)

const { uploads } = useUploads()
// Upload cards appear as soon as their project exists, and update when the upload ends.
watch(
  () => Object.keys(uploads.value).join(),
  () => void refresh(),
)

const selected = ref<ProjectDto | null>(null)
const action = ref<'rename' | 'trash' | null>(null)
function openAction(project: ProjectDto, kind: 'rename' | 'trash') {
  selected.value = project
  action.value = kind
}
</script>

<template>
  <PageShell title="Projects">
    <div class="mx-auto w-full max-w-6xl space-y-6">
      <AddVideoPanel @links="onLinks" @files="onFiles" />

      <UEmpty
        v-if="!projects.length"
        icon="i-lucide-clapperboard"
        title="No projects yet"
        description="Paste a YouTube link or upload a video above. Each video becomes a project you can cut clips from."
        variant="naked"
        size="lg"
        class="py-12"
      />

      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <ProjectCard
          v-for="project in projects"
          :key="project.id"
          :project="project"
          @rename="openAction(project, 'rename')"
          @trash="openAction(project, 'trash')"
        />
      </div>
    </div>

    <YoutubeImportModal v-model:open="youtubeOpen" :links="pendingLinks" @created="refresh()" />
    <UploadImportModal v-model:open="uploadOpen" :files="pendingFiles" />
    <ProjectActionModals v-model:action="action" :project="selected" @changed="refresh()" />
  </PageShell>
</template>
