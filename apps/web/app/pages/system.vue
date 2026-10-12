<script setup lang="ts">
import type { JobDto } from '@clipstudio/core/shared'

const { data, refresh, status } = await useFetch('/api/system', { server: false })
// The sidebar polls the worker heartbeat; reuse it so this card stays current.
const { data: liveWorker } = await useWorkerStatus()
const worker = computed(() => liveWorker.value ?? data.value?.worker)
const { jobs, merge } = useJobs()
const toast = useToast()
const now = useNow(5_000)

const missing = computed(() => data.value?.tools.filter((t) => !t.found) ?? [])
const installAll = computed(() => {
  const formulas = [...new Set(missing.value.map((t) => t.installHint.replace('brew install ', '')))]
  return formulas.length ? `brew install ${formulas.join(' ')}` : ''
})

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: 'Copied', description: text, icon: 'i-lucide-clipboard-check' })
}

// Test job
const seconds = ref(15)
const failOnce = ref(false)
const starting = ref(false)
const startedId = ref<string | null>(null)
const testJob = computed(() => (startedId.value ? jobs.value.find((j) => j.id === startedId.value) : undefined))

async function startTestJob() {
  starting.value = true
  try {
    const job = await $fetch<JobDto>('/api/jobs/demo', {
      method: 'POST',
      body: { seconds: seconds.value, failAtPercent: failOnce.value ? 50 : undefined },
    })
    merge([job])
    startedId.value = job.id
  } catch (error) {
    toast.add({ title: 'Could not start the test job', description: (error as Error).message, color: 'error' })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <PageShell title="System check">
    <template #actions>
      <UButton
        label="Check again"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </template>

    <div class="mx-auto w-full max-w-3xl space-y-6">
      <div v-if="!data" class="space-y-3">
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-48 w-full" />
      </div>

      <template v-else>
        <UAlert
          v-if="worker && !worker.online"
          color="error"
          variant="subtle"
          icon="i-lucide-power-off"
          title="The background worker isn't running"
          description="Downloads, transcription and rendering happen in the worker. Stop the app and start it again with pnpm dev from the project folder; that starts both the app and the worker."
        />
        <UAlert
          v-else-if="missing.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-wrench"
          :title="`${missing.length} of ${data.tools.length} tools still to install`"
          description="Run the command below in Terminal, then press Check again."
        >
          <template #actions>
            <UButton :label="installAll" icon="i-lucide-copy" color="neutral" variant="outline" size="sm" class="font-mono" @click="copy(installAll)" />
          </template>
        </UAlert>
        <UAlert
          v-else
          color="success"
          variant="subtle"
          icon="i-lucide-circle-check"
          title="Everything is installed"
          description="This Mac has every tool Clip Studio needs."
        />

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h2 class="font-semibold">Tools</h2>
            <p class="text-sm text-muted">Programs Clip Studio runs on this Mac.</p>
          </template>
          <ul class="divide-y divide-default">
            <li v-for="tool in data.tools" :key="tool.id" class="flex items-center gap-4 px-4 py-3 sm:px-6">
              <UIcon
                :name="tool.found ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
                class="size-5 shrink-0"
                :class="tool.found ? 'text-success' : 'text-muted'"
              />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-highlighted">
                  {{ tool.name }}
                  <span v-if="tool.version" class="ml-1 font-normal text-muted">{{ tool.version }}</span>
                </p>
                <p class="text-xs text-muted">{{ tool.purpose }}</p>
              </div>
              <UBadge v-if="tool.found" label="Installed" color="success" variant="subtle" />
              <template v-else>
                <UBadge :label="`Needed from phase ${tool.neededFrom}`" color="neutral" variant="subtle" class="hidden sm:inline-flex" />
                <UButton :label="tool.installHint" icon="i-lucide-copy" color="neutral" variant="outline" size="xs" class="font-mono" @click="copy(tool.installHint)" />
              </template>
            </li>
          </ul>
        </UCard>

        <SpeechModels />

        <div class="grid gap-6 sm:grid-cols-2">
          <UCard>
            <h2 class="font-semibold">Background worker</h2>
            <div class="mt-3 flex items-center gap-2 text-sm">
              <span class="size-2 rounded-full" :class="worker?.online ? 'bg-success' : 'bg-error'" />
              {{ worker?.online ? 'Running' : 'Offline' }}
              <span v-if="worker?.lastSeen" class="text-muted">· seen {{ timeAgo(worker.lastSeen, now) }}</span>
            </div>
            <p v-if="worker?.concurrency" class="mt-2 text-xs text-muted">
              Runs at once:
              {{ Object.entries(worker.concurrency).map(([group, n]) => `${group} ${n}`).join(' · ') }}
            </p>
          </UCard>

          <UCard>
            <h2 class="font-semibold">Storage</h2>
            <p class="mt-3 text-sm">
              {{ formatBytes(data.storage.freeBytes) }} free
              <span class="text-muted">of {{ formatBytes(data.storage.totalBytes) }}</span>
            </p>
            <p class="mt-2 truncate font-mono text-xs text-muted" :title="data.storage.dataDir">{{ data.storage.dataDir }}</p>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <h2 class="font-semibold">Test the job runner</h2>
            <p class="text-sm text-muted">
              Starts a harmless job that counts for a few seconds, so you can see progress, cancelling and retries work.
            </p>
          </template>

          <div class="flex flex-wrap items-end gap-4">
            <UFormField label="Seconds">
              <UInputNumber v-model="seconds" :min="1" :max="600" class="w-28" />
            </UFormField>
            <USwitch v-model="failOnce" label="Fail halfway the first time" description="Shows an automatic retry." />
            <UButton
              label="Start test job"
              icon="i-lucide-play"
              :loading="starting"
              :disabled="!worker?.online"
              class="ml-auto"
              @click="startTestJob"
            />
          </div>

          <template v-if="testJob" #footer>
            <JobItem :job="testJob" />
          </template>
        </UCard>

        <p class="text-center text-xs text-muted">Node {{ data.node }}</p>
      </template>
    </div>
  </PageShell>
</template>
