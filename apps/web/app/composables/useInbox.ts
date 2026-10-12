/** Pending proposal count, polled for the sidebar badge. Shows a toast when Claude sends something new. */
export function useInboxCount() {
  const pending = useState('inbox-pending', () => 0)
  /** Scheduled posts that missed their time (the Mac was asleep). */
  const missed = useState('posts-missed', () => 0)
  return { pending, missed }
}

let started = false

export function startInboxPolling() {
  if (started || !import.meta.client) return
  started = true
  const { pending, missed } = useInboxCount()
  const toast = useToast()
  let first = true
  const check = async () => {
    try {
      const { pending: n, missed: m } = await $fetch<{ pending: number; missed: number }>('/api/inbox/count')
      if (!first && m > missed.value) {
        toast.add({
          title: 'A scheduled post missed its time',
          description: 'The Mac was asleep. Decide what to do in the Calendar.',
          color: 'error',
          icon: 'i-lucide-alarm-clock-off',
          actions: [{ label: 'Open Calendar', to: '/calendar' }],
        })
      }
      missed.value = m
      if (!first && n > pending.value && useRoute().path !== '/inbox') {
        toast.add({
          title: 'New proposal from Claude',
          description: 'Review it in the Inbox. Nothing happens until you approve.',
          icon: 'i-lucide-inbox',
          actions: [{ label: 'Open Inbox', to: '/inbox' }],
        })
      }
      pending.value = n
      first = false
    } catch {
      // The server is restarting; try again on the next tick.
    }
  }
  void check()
  setInterval(check, 5_000)
}
