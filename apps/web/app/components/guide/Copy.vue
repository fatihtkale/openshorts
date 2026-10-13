<script setup lang="ts">
/** A command or a prompt with a copy button. Commands are monospace; prompts read like speech. */
const props = withDefaults(defineProps<{ text: string; kind?: 'command' | 'prompt' }>(), { kind: 'command' })
const toast = useToast()
async function copy() {
  await navigator.clipboard.writeText(props.text)
  toast.add({ title: 'Copied', description: props.kind === 'prompt' ? 'Paste it into Claude.' : 'Paste it into Terminal.', icon: 'i-lucide-clipboard-check' })
}
</script>

<template>
  <div class="flex items-center gap-2 rounded-md border border-default bg-elevated/50 py-1.5 pr-1.5 pl-3">
    <UIcon v-if="kind === 'prompt'" name="i-lucide-message-square" class="size-4 shrink-0 text-primary" />
    <span v-else class="shrink-0 font-mono text-xs text-dimmed select-none">$</span>
    <span class="min-w-0 flex-1 text-sm break-words" :class="kind === 'command' ? 'font-mono text-xs' : ''">{{ kind === 'prompt' ? `“${text}”` : text }}</span>
    <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" :aria-label="`Copy ${kind}`" @click="copy" />
  </div>
</template>
