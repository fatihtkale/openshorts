<script setup lang="ts">
/** A numbered tutorial step with an optional "go there" link. */
defineProps<{ n: number; title: string; to?: string; toLabel?: string }>()
</script>

<template>
  <li class="relative flex gap-4 pb-8 last:pb-0">
    <!-- the line joining the step numbers -->
    <span class="absolute top-9 bottom-0 left-4 w-px bg-default" aria-hidden="true" />
    <span class="z-10 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-inverted">{{ n }}</span>
    <div class="min-w-0 flex-1 space-y-2 pt-1">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-semibold text-highlighted">{{ title }}</h3>
        <UButton v-if="to" :to="to" :label="toLabel ?? 'Open'" trailing-icon="i-lucide-arrow-right" color="neutral" variant="link" size="xs" class="p-0" />
      </div>
      <div class="space-y-2 text-sm text-default">
        <slot />
      </div>
    </div>
  </li>
</template>
