<script setup lang="ts">
/** A colour swatch with a native picker. Keeps an alpha suffix (#RRGGBBAA) if the value had one. */
defineProps<{ label: string }>()
const model = defineModel<string>({ required: true })

const hex = computed(() => model.value.slice(0, 7))
function onInput(e: Event) {
  const alpha = model.value.length === 9 ? model.value.slice(7) : ''
  model.value = (e.target as HTMLInputElement).value.toUpperCase() + alpha
}
</script>

<template>
  <label class="flex cursor-pointer items-center gap-2 rounded-md border border-default px-2 py-1.5 text-sm hover:bg-elevated">
    <span class="relative size-5 shrink-0 overflow-hidden rounded border border-default" :style="{ background: model }">
      <input type="color" :value="hex" class="absolute inset-0 cursor-pointer opacity-0" @input="onInput" />
    </span>
    <span class="truncate">{{ label }}</span>
  </label>
</template>
