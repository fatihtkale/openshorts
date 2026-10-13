<script setup lang="ts">
import { PLATFORM_LABELS, type AccountDto, type Platform } from '@clipstudio/core/shared'

interface AccountsResponse {
  accounts: AccountDto[]
  platforms: Record<Platform, { configured: boolean; redirectUri: string }>
}

const { data, refresh } = await useFetch<AccountsResponse>('/api/accounts')
const route = useRoute()
const router = useRouter()
const toast = useToast()

// Back from a sign-in: say how it went, then tidy the address bar.
onMounted(() => {
  if (route.query.connected) toast.add({ title: 'Connected', description: String(route.query.connected), color: 'success', icon: 'i-lucide-check' })
  if (route.query.error) toast.add({ title: 'Could not connect', description: String(route.query.error), color: 'error', duration: 10_000 })
  if (route.query.connected || route.query.error) router.replace('/accounts')
})

const platforms: { id: Platform; icon: string; envKeys: [string, string]; console: string; consoleLabel: string; steps: string[] }[] = [
  {
    id: 'youtube',
    icon: 'i-simple-icons-youtube',
    envKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    console: 'https://console.cloud.google.com/apis/credentials',
    consoleLabel: 'Google Cloud console',
    steps: [
      'Create a project and enable “YouTube Data API v3”.',
      'OAuth consent screen: External, add your Google accounts as test users, then “Publish app” (otherwise sign-ins expire after 7 days).',
      'Credentials → Create OAuth client ID → Web application, with the redirect address below.',
      'Put the client ID and secret in .env and restart the app.',
    ],
  },
  {
    id: 'tiktok',
    icon: 'i-simple-icons-tiktok',
    envKeys: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    console: 'https://developers.tiktok.com/apps',
    consoleLabel: 'TikTok for Developers',
    steps: [
      'Create an app and choose the Desktop platform.',
      'Add the products Login Kit, Content Posting API (switch on Direct Post) and Display API (for view counts on Insights).',
      'Login Kit: add the redirect address below.',
      'Put the client key and secret in .env and restart the app.',
    ],
  },
]

function accountsFor(p: Platform) {
  return data.value?.accounts.filter((a) => a.platform === p) ?? []
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: 'Copied', icon: 'i-lucide-clipboard-check' })
}

const removing = ref<AccountDto | null>(null)
const removeOpen = computed({ get: () => !!removing.value, set: (v) => !v && (removing.value = null) })
const busy = ref(false)
async function disconnect() {
  if (!removing.value) return
  busy.value = true
  try {
    await $fetch(`/api/accounts/${removing.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Disconnected', description: removing.value.displayName })
    removing.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not disconnect', description: (e as Error).message, color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PageShell title="Accounts">
    <div class="mx-auto w-full max-w-3xl space-y-6">
      <p class="text-sm text-muted">
        Connect the channels you post to. Nothing is ever posted without you confirming the post, its text and who can see it.
      </p>

      <UCard v-for="p in platforms" :key="p.id">
        <template #header>
          <div class="flex items-center gap-3">
            <UIcon :name="p.icon" class="size-6" />
            <h2 class="flex-1 font-semibold">{{ PLATFORM_LABELS[p.id] }}</h2>
            <UButton
              v-if="data?.platforms[p.id].configured"
              :label="accountsFor(p.id).length ? 'Connect another' : `Connect ${PLATFORM_LABELS[p.id]}`"
              icon="i-lucide-plus"
              :to="`/api/auth/${p.id}/start`"
              external
              size="sm"
            />
            <UBadge v-else label="Not set up" color="neutral" variant="subtle" />
          </div>
        </template>

        <!-- Setup steps until the app keys are in .env -->
        <div v-if="!data?.platforms[p.id].configured" class="space-y-4 text-sm">
          <ol class="list-decimal space-y-1.5 pl-5 text-muted">
            <li v-for="step in p.steps" :key="step">{{ step }}</li>
          </ol>
          <div class="space-y-1">
            <p class="text-xs font-medium">Redirect address to register</p>
            <div class="flex items-center gap-2 rounded-md bg-elevated p-2 font-mono text-xs">
              <span class="flex-1 break-all">{{ data?.platforms[p.id].redirectUri }}</span>
              <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" aria-label="Copy" @click="copy(data!.platforms[p.id].redirectUri)" />
            </div>
          </div>
          <div class="space-y-1">
            <p class="text-xs font-medium">In .env</p>
            <pre class="rounded-md bg-elevated p-2 font-mono text-xs">{{ p.envKeys[0] }}=…
{{ p.envKeys[1] }}=…</pre>
          </div>
          <ULink :to="p.console" target="_blank" class="inline-flex items-center gap-1 text-primary">
            Open {{ p.consoleLabel }} <UIcon name="i-lucide-external-link" class="size-3" />
          </ULink>
        </div>

        <ul v-else-if="accountsFor(p.id).length" class="divide-y divide-default">
          <li v-for="a in accountsFor(p.id)" :key="a.id" class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <UAvatar :src="a.avatarUrl ?? undefined" :alt="a.displayName" size="md" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ a.displayName }}</p>
              <p class="text-xs text-muted">{{ a.username ? `@${a.username.replace(/^@/, '')}` : 'Connected' }}</p>
            </div>
            <UButton
              v-if="a.status === 'needs_reconnect'"
              label="Reconnect"
              icon="i-lucide-refresh-cw"
              color="warning"
              variant="soft"
              size="sm"
              :to="`/api/auth/${p.id}/start`"
              external
            />
            <UButton label="Disconnect" color="neutral" variant="ghost" size="sm" @click="removing = a" />
          </li>
        </ul>
        <p v-else class="text-sm text-muted">No {{ PLATFORM_LABELS[p.id] }} account connected yet.</p>

        <template v-if="data?.platforms[p.id].configured" #footer>
          <p class="text-xs text-muted">
            <template v-if="p.id === 'youtube'">
              Until Google approves this app (the YouTube API audit), uploads are locked to Private. Scheduled videos are published by YouTube
              itself, so your Mac can be off.
            </template>
            <template v-else>
              Until TikTok approves this app, it can only post as “Only me” to a private account, or send drafts to your TikTok inbox.
              TikTok has no scheduling of its own, so scheduled posts need this Mac awake at the time.
            </template>
          </p>
        </template>
      </UCard>
    </div>

    <UModal
      v-model:open="removeOpen"
      :title="`Disconnect ${removing?.displayName}?`"
      description="Clip Studio's access is revoked and its sign-in deleted from this Mac. Posts already made stay online."
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="removing = null" />
          <UButton label="Disconnect" color="error" :loading="busy" @click="disconnect" />
        </div>
      </template>
    </UModal>
  </PageShell>
</template>
