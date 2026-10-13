<script setup lang="ts">
import type { AccountDto, AiSettingsDto, ProjectDto } from '@clipstudio/core/shared'

/**
 * "Is everything set up?": reads the app's real state, so a new user (or a friend on their own Mac) can see
 * what's done and jump to whatever isn't. Refreshes itself every 10 seconds.
 */
interface SystemInfo {
  tools: { id: string; name: string; found: boolean }[]
  models: { id: string; label: string; installed: boolean }[]
  worker: { online: boolean }
}
const opts = { server: false } as const
const { data: system, refresh: r1 } = await useFetch<SystemInfo>('/api/system', opts)
const { data: mcp, refresh: r2 } = await useFetch<{ lastSeen: number | null }>('/api/mcp-status', opts)
const { data: ai, refresh: r3 } = await useFetch<AiSettingsDto>('/api/settings/ai', opts)
const { data: accounts, refresh: r4 } = await useFetch<{ accounts: AccountDto[] }>('/api/accounts', opts)
const { data: projects, refresh: r5 } = await useFetch<ProjectDto[]>('/api/projects', opts)
const { data: backups, refresh: r6 } = await useFetch<{ backups: unknown[] }>('/api/backups', opts)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => [r1, r2, r3, r4, r5, r6].forEach((r) => void r()), 10_000)))
onBeforeUnmount(() => clearInterval(timer))

interface Item {
  title: string
  done: boolean | null
  detail: string
  fix?: { label: string; to: string }
  optional?: boolean
}

const items = computed<Item[]>(() => {
  const missingTools = system.value?.tools.filter((t) => !t.found) ?? []
  const model = system.value?.models.find((m) => m.installed)
  const youtube = accounts.value?.accounts.find((a) => a.platform === 'youtube')
  const aiOn = !!ai.value && ai.value.provider !== 'off' && (ai.value.provider !== 'anthropic' || ai.value.hasAnthropicKey || ai.value.envKey)
  return [
    {
      title: 'The app is running',
      done: system.value ? system.value.worker.online : null,
      detail: system.value?.worker.online
        ? 'The background worker is on: imports, transcripts and exports will run.'
        : 'The background worker is off. In Terminal, in the Clip Studio folder, run pnpm dev and keep it open.',
      fix: system.value?.worker.online ? undefined : { label: 'System check', to: '/system' },
    },
    {
      title: 'Video tools installed',
      done: system.value ? missingTools.length === 0 : null,
      detail: missingTools.length ? `Missing: ${missingTools.map((t) => t.name).join(', ')}.` : 'ffmpeg, yt-dlp and whisper.cpp are all there.',
      fix: missingTools.length ? { label: 'How to install', to: '/system' } : undefined,
    },
    {
      title: 'Speech model downloaded',
      done: system.value ? !!model : null,
      detail: model ? `${model.label} turns speech into timed words.` : 'Needed for transcripts. Download one on the System check page (Large v3 Turbo is recommended).',
      fix: model ? undefined : { label: 'Download a model', to: '/system' },
    },
    {
      title: 'An AI to find clips',
      done: mcp.value === undefined && ai.value === undefined ? null : !!mcp.value?.lastSeen || aiOn,
      detail: mcp.value?.lastSeen
        ? 'Claude has connected to the app. Ask it to find clips.'
        : aiOn
          ? 'In-app AI is on: use “Find clips with AI” on a project.'
          : 'Connect Claude (Claude Code or Claude Desktop), or turn on in-app AI. You can always make clips by hand too.',
      fix: mcp.value?.lastSeen || aiOn ? undefined : { label: 'Connect Claude', to: '/settings' },
    },
    {
      title: 'YouTube connected',
      done: accounts.value ? youtube?.status === 'connected' : null,
      detail: youtube
        ? youtube.status === 'connected'
          ? `Posting as ${youtube.displayName}.`
          : `${youtube.displayName} needs to sign in again.`
        : 'Sign in with the Google account that owns your channel, so the app can upload Shorts.',
      fix: youtube?.status === 'connected' ? undefined : { label: 'Accounts', to: '/accounts' },
    },
    {
      title: 'First video added',
      done: projects.value ? projects.value.length > 0 : null,
      detail: projects.value?.length ? `${projects.value.length} project${projects.value.length === 1 ? '' : 's'} so far.` : 'Paste a YouTube link or upload a file on the Projects page.',
      fix: projects.value?.length ? undefined : { label: 'Add a video', to: '/' },
    },
    {
      title: 'Backups',
      done: backups.value ? backups.value.backups.length > 0 : null,
      detail: backups.value?.backups.length
        ? 'The app keeps a daily copy of its database.'
        : 'The first one is made automatically within an hour of starting the app.',
      fix: backups.value?.backups.length ? undefined : { label: 'Back up now', to: '/settings' },
      optional: true,
    },
  ]
})
const required = computed(() => items.value.filter((i) => !i.optional))
const doneCount = computed(() => required.value.filter((i) => i.done).length)
</script>

<template>
  <UCard>
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <p class="font-medium">
          {{ doneCount === required.length ? 'All set. You can make Shorts.' : `${doneCount} of ${required.length} done` }}
        </p>
        <UProgress :model-value="doneCount" :max="required.length" size="sm" class="min-w-32 flex-1" :color="doneCount === required.length ? 'success' : 'primary'" />
      </div>
      <ul class="divide-y divide-default">
        <li v-for="item in items" :key="item.title" class="flex items-start gap-3 py-3">
          <UIcon
            :name="item.done === null ? 'i-lucide-loader-circle' : item.done ? 'i-lucide-circle-check' : item.optional ? 'i-lucide-circle-dashed' : 'i-lucide-circle-alert'"
            class="mt-0.5 size-5 shrink-0"
            :class="item.done === null ? 'animate-spin text-dimmed' : item.done ? 'text-success' : item.optional ? 'text-muted' : 'text-warning'"
          />
          <div class="min-w-0 flex-1">
            <p class="font-medium">
              {{ item.title }}
              <span v-if="item.optional" class="text-xs font-normal text-dimmed">optional</span>
            </p>
            <p class="text-sm text-muted">{{ item.detail }}</p>
          </div>
          <UButton v-if="item.fix" :to="item.fix.to" :label="item.fix.label" color="neutral" variant="outline" size="xs" trailing-icon="i-lucide-arrow-right" />
        </li>
      </ul>
    </div>
  </UCard>
</template>
