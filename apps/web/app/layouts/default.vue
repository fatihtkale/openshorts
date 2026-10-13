<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const soon = { label: 'Soon', variant: 'subtle' as const, color: 'neutral' as const, size: 'sm' as const }

const { pending, missed } = useInboxCount()
onMounted(startInboxPolling)

const items = computed<NavigationMenuItem[][]>(() => [
  [
    { label: 'Projects', icon: 'i-lucide-folder-open', to: '/' },
    {
      label: 'Inbox',
      icon: 'i-lucide-inbox',
      to: '/inbox',
      badge: pending.value ? { label: String(pending.value), color: 'primary' as const, variant: 'solid' as const, size: 'sm' as const } : undefined,
    },
    {
      label: 'Calendar',
      icon: 'i-lucide-calendar-days',
      to: '/calendar',
      badge: missed.value ? { label: `${missed.value} missed`, color: 'error' as const, variant: 'subtle' as const, size: 'sm' as const } : undefined,
    },
    { label: 'Insights', icon: 'i-lucide-chart-column', to: '/insights' },
    { label: 'Accounts', icon: 'i-lucide-at-sign', to: '/accounts' },
    { label: 'Trash', icon: 'i-lucide-trash-2', to: '/trash' },
  ],
  [
    { label: 'Guide', icon: 'i-lucide-book-open', to: '/guide' },
    { label: 'System check', icon: 'i-lucide-activity', to: '/system' },
    { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
  ],
])
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar id="main" collapsible resizable unit="rem" :default-size="15" :min-size="13" :max-size="20" :ui="{ footer: 'border-t border-default' }">
      <template #header="{ collapsed }">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold">
          <span class="grid size-7 place-items-center rounded-md bg-primary text-inverted">
            <UIcon name="i-lucide-scissors" class="size-4" />
          </span>
          <span v-if="!collapsed">Clip Studio</span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="items[0]" orientation="vertical" />
        <UNavigationMenu :collapsed="collapsed" :items="items[1]" orientation="vertical" class="mt-auto" />
      </template>

      <template #footer="{ collapsed }">
        <WorkerStatus :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <slot />
    <GlobalDropZone />
  </UDashboardGroup>
</template>
