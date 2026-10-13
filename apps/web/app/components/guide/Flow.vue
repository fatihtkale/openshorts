<script setup lang="ts">
/** How a long video becomes a posted Short, one stage per box; each links to its part of the guide. */
const stages = [
  { icon: 'i-lucide-video', title: 'Add a video', text: 'YouTube link or a file', href: '#first-short' },
  { icon: 'i-lucide-audio-lines', title: 'Transcript', text: 'Every word, timed', href: '#first-short' },
  { icon: 'i-lucide-sparkles', title: 'Find clips', text: 'Claude, in-app AI or you', href: '#claude' },
  { icon: 'i-lucide-inbox', title: 'Review', text: 'Approve in the Inbox', href: '#scores' },
  { icon: 'i-lucide-wand-sparkles', title: 'Edit', text: 'Captions, layout, hook', href: '#editor' },
  { icon: 'i-lucide-film', title: 'Export', text: 'Vertical MP4', href: '#editor' },
  { icon: 'i-lucide-send', title: 'Post', text: 'Now or scheduled', href: '#posting' },
  { icon: 'i-lucide-chart-column', title: 'Learn', text: 'Best posting hours', href: '#insights' },
]
</script>

<template>
  <ol class="grid grid-cols-2 gap-2 sm:grid-cols-4">
    <li v-for="(s, i) in stages" :key="s.title" class="relative">
      <a :href="s.href" class="flex h-full flex-col gap-1.5 rounded-lg border border-default bg-default p-3 transition hover:border-primary/60 hover:bg-elevated/50">
        <span class="flex items-center gap-2">
          <span class="text-xs font-medium text-dimmed tabular-nums">{{ i + 1 }}</span>
          <UIcon :name="s.icon" class="size-4 text-primary" />
        </span>
        <span class="text-sm font-medium text-highlighted">{{ s.title }}</span>
        <span class="text-xs text-muted">{{ s.text }}</span>
      </a>
    </li>
  </ol>
</template>
