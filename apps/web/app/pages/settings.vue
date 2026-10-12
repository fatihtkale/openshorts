<script setup lang="ts">
import { COMMON_TIME_ZONES } from '@clipstudio/core/shared'

const { data: status, refresh } = await useFetch<{ client: string | null; lastSeen: number | null; url: string }>('/api/mcp-status', {
  server: false,
})
const toast = useToast()
const now = useNow(5_000)

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => refresh(), 5_000)))
onBeforeUnmount(() => clearInterval(timer))

const url = computed(() => status.value?.url ?? 'http://127.0.0.1:3000/mcp')
const claudeCodeCommand = computed(() => `claude mcp add --transport http --scope user clipstudio ${url.value}`)
const desktopConfig = computed(() =>
  JSON.stringify({ mcpServers: { clipstudio: { command: 'npx', args: ['-y', 'mcp-remote', url.value] } } }, null, 2),
)
const tryPrompt = 'Find the best clips in my latest Clip Studio project'

const clientName = computed(() => {
  const c = status.value?.client
  if (!c) return 'An MCP client'
  return c.replace(/[-_]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
})
const recentlyUsed = computed(() => !!status.value?.lastSeen && now.value - status.value.lastSeen < 24 * 3600_000)

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: 'Copied', icon: 'i-lucide-clipboard-check' })
}

// ── Posting defaults ────────────────────────────────────────────────
interface Defaults {
  timeZone: string
  windowStart: string
  windowEnd: string
  mode: 'edges' | 'centred' | 'custom'
  jitterMin: number
  minGapMin: number
}
const { data: defaults } = await useFetch<Defaults>('/api/settings/schedule', { server: false })
const savingDefaults = ref(false)
async function saveDefaults() {
  if (!defaults.value) return
  savingDefaults.value = true
  try {
    defaults.value = await $fetch<Defaults>('/api/settings/schedule', { method: 'PUT', body: defaults.value })
    toast.add({ title: 'Posting defaults saved', icon: 'i-lucide-check' })
  } catch (e) {
    toast.add({ title: 'Could not save', description: (e as Error).message, color: 'error' })
  } finally {
    savingDefaults.value = false
  }
}
const zoneItems = computed(() =>
  [...new Set([defaults.value?.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone, ...COMMON_TIME_ZONES].filter(Boolean) as string[])].map((z) => ({
    label: z.replace(/_/g, ' '),
    value: z,
  })),
)

const tools = [
  { name: 'Read', icon: 'i-lucide-eye', items: 'projects, transcripts, search, video frames, clips, past proposals' },
  { name: 'Propose', icon: 'i-lucide-inbox', items: 'clips to cut, YouTube videos to import. Proposals wait in the Inbox for you' },
  { name: 'Never', icon: 'i-lucide-shield-check', items: 'approve, delete, download or publish anything by itself' },
]
</script>

<template>
  <PageShell title="Settings">
    <div class="mx-auto w-full max-w-3xl space-y-6">
      <UCard>
        <template #header>
          <div class="flex items-start gap-3">
            <div class="flex-1">
              <h2 class="font-semibold">Connect Claude</h2>
              <p class="text-sm text-muted">
                Claude does the AI work (finding clips, writing titles) through this app's MCP server, using your own Claude plan.
              </p>
            </div>
            <UBadge
              v-if="status?.lastSeen"
              :label="recentlyUsed ? 'Connected' : 'Not used lately'"
              :color="recentlyUsed ? 'success' : 'neutral'"
              variant="subtle"
            />
          </div>
          <p v-if="status?.lastSeen" class="mt-2 text-xs text-muted">{{ clientName }} last used it {{ timeAgo(status.lastSeen, now) }}.</p>
          <p v-else class="mt-2 text-xs text-muted">No assistant has connected yet.</p>
        </template>

        <div class="space-y-6 text-sm">
          <section class="space-y-2">
            <h3 class="font-medium">Claude Code <UBadge label="Recommended" color="primary" variant="subtle" size="sm" class="ml-1" /></h3>
            <p class="text-muted">
              Open Claude Code in this project's folder; it finds the server on its own (approve “clipstudio” when it asks). To use it from
              any folder, run this once:
            </p>
            <div class="flex items-center gap-2 rounded-md bg-elevated p-2 font-mono text-xs">
              <span class="flex-1 break-all">{{ claudeCodeCommand }}</span>
              <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" aria-label="Copy command" @click="copy(claudeCodeCommand)" />
            </div>
          </section>

          <section class="space-y-2">
            <h3 class="font-medium">Claude Desktop</h3>
            <p class="text-muted">
              Add this to <code class="rounded bg-elevated px-1">~/Library/Application Support/Claude/claude_desktop_config.json</code>, then
              restart Claude Desktop.
            </p>
            <div class="relative rounded-md bg-elevated p-3 font-mono text-xs">
              <pre class="overflow-x-auto">{{ desktopConfig }}</pre>
              <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" class="absolute top-2 right-2" aria-label="Copy config" @click="copy(desktopConfig)" />
            </div>
          </section>

          <section class="space-y-2">
            <h3 class="font-medium">Then ask</h3>
            <div class="flex items-center gap-2 rounded-md border border-default p-2">
              <UIcon name="i-lucide-message-square" class="size-4 shrink-0 text-muted" />
              <span class="flex-1">“{{ tryPrompt }}”</span>
              <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" aria-label="Copy prompt" @click="copy(tryPrompt)" />
            </div>
            <p class="text-xs text-muted">
              In Claude Code you can also type <code class="rounded bg-elevated px-1">/mcp__clipstudio__find_clips</code>. Keep this app running
              (<code class="rounded bg-elevated px-1">pnpm dev</code>) while Claude works.
            </p>
          </section>

          <section class="space-y-2">
            <h3 class="font-medium">What Claude can do here</h3>
            <ul class="space-y-2">
              <li v-for="t in tools" :key="t.name" class="flex gap-3">
                <UIcon :name="t.icon" class="mt-0.5 size-4 shrink-0 text-muted" />
                <span><span class="font-medium">{{ t.name }}:</span> <span class="text-muted">{{ t.items }}</span></span>
              </li>
            </ul>
          </section>
        </div>
      </UCard>

      <UCard v-if="defaults">
        <template #header>
          <h2 class="font-semibold">Posting defaults</h2>
          <p class="text-sm text-muted">
            Where the scheduler starts. The defaults aim at a US audience: weekday afternoons and evenings are when the posting studies
            agree people watch most.
          </p>
        </template>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Audience time zone" class="sm:col-span-2">
            <USelect v-model="defaults.timeZone" :items="zoneItems" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="Post from">
            <UInput v-model="defaults.windowStart" type="time" class="w-full" />
          </UFormField>
          <UFormField label="Until">
            <UInput v-model="defaults.windowEnd" type="time" class="w-full" />
          </UFormField>
          <UFormField label="Spread">
            <USelect
              v-model="defaults.mode"
              :items="[
                { label: 'Edge to edge', value: 'edges' },
                { label: 'Centred', value: 'centred' },
                { label: 'My own times', value: 'custom' },
              ]"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="`Warn when posts are less than ${defaults.minGapMin} min apart`">
            <USlider v-model="defaults.minGapMin" :min="0" :max="240" :step="15" />
          </UFormField>
          <UFormField :label="defaults.jitterMin ? `Vary times by up to ±${defaults.jitterMin} min` : 'Exact times'">
            <USlider v-model="defaults.jitterMin" :min="0" :max="30" :step="5" />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end">
            <UButton label="Save defaults" :loading="savingDefaults" @click="saveDefaults" />
          </div>
        </template>
      </UCard>
    </div>
  </PageShell>
</template>
