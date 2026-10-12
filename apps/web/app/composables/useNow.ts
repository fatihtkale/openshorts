/** A shared clock that ticks every `intervalMs`, for relative times like "2 min ago". */
export function useNow(intervalMs = 10_000) {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => (timer = setInterval(() => (now.value = Date.now()), intervalMs)))
  onBeforeUnmount(() => clearInterval(timer))
  return now
}
