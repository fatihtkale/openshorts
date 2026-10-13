<script setup lang="ts">
/** One chapter of the guide: an anchor the table of contents can jump to, a title and a one-line summary. */
defineProps<{ id: string; title: string; icon: string; lead?: string }>()
</script>

<template>
  <section :id="id" class="scroll-mt-6 space-y-5" data-guide-section>
    <header class="space-y-1.5">
      <h2 class="flex items-center gap-2.5 text-xl font-semibold text-highlighted">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10">
          <UIcon :name="icon" class="size-4.5 text-primary" />
        </span>
        <a :href="`#${id}`" class="hover:underline">{{ title }}</a>
      </h2>
      <p v-if="lead" class="text-muted">{{ lead }}</p>
    </header>
    <div class="space-y-4 leading-relaxed">
      <slot />
    </div>
  </section>
</template>
