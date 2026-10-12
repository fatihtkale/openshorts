<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

/**
 * A button that needs a second click to act. The first click arms it and changes the label;
 * it disarms itself after a few seconds.
 */
const props = withDefaults(
  defineProps<{
    label: string
    confirmLabel: string
    icon?: string
    color?: ButtonProps['color']
    size?: ButtonProps['size']
  }>(),
  { color: 'neutral', size: 'xs', icon: undefined },
)
const emit = defineEmits<{ confirm: [] }>()

const armed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function click() {
  if (armed.value) {
    clearTimeout(timer)
    armed.value = false
    emit('confirm')
    return
  }
  armed.value = true
  timer = setTimeout(() => (armed.value = false), 4_000)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <UButton
    :label="armed ? props.confirmLabel : props.label"
    :icon="props.icon"
    :color="armed ? 'error' : props.color"
    :variant="armed ? 'solid' : 'ghost'"
    :size="props.size"
    @click="click"
  />
</template>
