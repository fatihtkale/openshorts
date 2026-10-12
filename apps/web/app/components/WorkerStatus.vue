<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()

const { data, refresh } = await useWorkerStatus()

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => refresh(), 5_000)))
onBeforeUnmount(() => clearInterval(timer))

const state = computed(() => {
  if (!data.value) return { dot: 'bg-neutral-400', label: 'Checking worker…', tip: 'Looking for the background worker.' }
  if (data.value.online) return { dot: 'bg-success', label: 'Worker running', tip: 'The background worker is processing jobs.' }
  return { dot: 'bg-error', label: 'Worker offline', tip: 'Start it with pnpm dev from the project folder.' }
})
</script>

<template>
  <UTooltip :text="state.tip">
    <NuxtLink to="/system" class="flex items-center gap-2 text-sm text-muted hover:text-default">
      <span class="size-2 shrink-0 rounded-full" :class="state.dot" />
      <span v-if="!collapsed">{{ state.label }}</span>
    </NuxtLink>
  </UTooltip>
</template>
