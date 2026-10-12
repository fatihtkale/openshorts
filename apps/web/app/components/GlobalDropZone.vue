<script setup lang="ts">
// Lets video files be dropped on any page: they're handed to the Projects page's import dialog.
// Without this, dropping a file outside the Projects page would make the browser open the file itself.
const dropped = useDroppedFiles()
const dragging = ref(false)
let depth = 0

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

function onDragEnter(e: DragEvent) {
  if (!hasFiles(e)) return
  depth++
  dragging.value = true
}
function onDragLeave(e: DragEvent) {
  if (!hasFiles(e)) return
  depth = Math.max(0, depth - 1)
  if (depth === 0) dragging.value = false
}
function onDragOver(e: DragEvent) {
  if (hasFiles(e)) e.preventDefault()
}
async function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  depth = 0
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (!files.length) return
  dropped.value = files
  await navigateTo('/')
}

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="dragging" class="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-primary/10 backdrop-blur-sm">
      <div class="rounded-xl border-2 border-dashed border-primary bg-default px-10 py-8 text-center">
        <UIcon name="i-lucide-upload" class="size-8 text-primary" />
        <p class="mt-2 font-medium">Drop to import</p>
        <p class="text-sm text-muted">You'll check the files before anything uploads.</p>
      </div>
    </div>
  </Teleport>
</template>
