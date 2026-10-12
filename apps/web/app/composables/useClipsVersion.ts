/** Bumped whenever clips change, so every clip list on screen refreshes. */
export function useClipsVersion() {
  return useState('clips-version', () => 0)
}
