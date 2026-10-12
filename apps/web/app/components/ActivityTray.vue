<script setup lang="ts">
const { jobs, active, connected } = useJobs()
const open = ref(false)

const recent = computed(() => jobs.value.filter((j) => j.status !== 'queued' && j.status !== 'running').slice(0, 20))
</script>

<template>
  <USlideover v-model:open="open" title="Activity" description="Everything running in the background.">
    <UChip :text="active.length" :show="active.length > 0" size="3xl">
      <UButton icon="i-lucide-list-checks" color="neutral" variant="ghost" aria-label="Activity" />
    </UChip>

    <template #body>
      <div class="mb-2 flex items-center gap-2 text-xs text-muted">
        <span class="size-2 rounded-full" :class="connected ? 'bg-success' : 'bg-warning'" />
        {{ connected ? 'Live' : 'Reconnecting…' }}
      </div>

      <UEmpty
        v-if="jobs.length === 0"
        icon="i-lucide-coffee"
        title="Nothing running"
        description="Downloads, transcriptions and renders show up here while they work."
        variant="naked"
      />

      <template v-else>
        <section v-if="active.length">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">In progress</h3>
          <div class="divide-y divide-default">
            <JobItem v-for="job in active" :key="job.id" :job="job" />
          </div>
        </section>
        <section v-if="recent.length" :class="{ 'mt-6': active.length }">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Recent</h3>
          <div class="divide-y divide-default">
            <JobItem v-for="job in recent" :key="job.id" :job="job" />
          </div>
        </section>
      </template>
    </template>
  </USlideover>
</template>
