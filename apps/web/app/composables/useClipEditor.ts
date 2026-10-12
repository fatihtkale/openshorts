import {
  effectiveCuts,
  faceCoverage,
  keptSegments,
  outputDuration,
  resolveLayout,
  wordsToOutput,
  type ClipEdit,
  type FaceTrack,
} from '@clipstudio/captions'
import type { ClipDto, ProjectDto, RenderDto, Word } from '@clipstudio/core/shared'

export interface EditorData {
  clip: ClipDto
  project: ProjectDto
  /** Transcript words from 30 s before to 30 s after the clip. */
  words: Word[]
  renders: RenderDto[]
}

export interface Draft {
  title: string
  startMs: number
  endMs: number
  edit: ClipEdit
}

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'

const clone = <T>(v: T): T => structuredClone(toRaw(v))

/**
 * The clip editor's state: a draft of the clip that every panel edits, with undo/redo and autosave.
 * Changes are saved ~0.7 s after the last edit; the clip's version guards against another tab's changes.
 */
export function useClipEditor(id: MaybeRefOrGetter<string>) {
  const toast = useToast()
  const { data, error, refresh } = useFetch<EditorData>(() => `/api/clips/${toValue(id)}`)

  const draft = ref<Draft | null>(null)
  const version = ref(0)
  const saveState = ref<SaveState>('saved')
  const past = ref<Draft[]>([])
  const future = ref<Draft[]>([])
  let lastKey: string | null = null
  let lastAt = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  watch(
    data,
    (d) => {
      if (!d) return
      // Take the server's copy when there's no draft yet, or after a reload.
      if (!draft.value || d.clip.version > version.value) {
        draft.value = { title: d.clip.title, startMs: d.clip.startMs, endMs: d.clip.endMs, edit: clone(d.clip.edit) }
        version.value = d.clip.version
        saveState.value = 'saved'
      }
    },
    { immediate: true },
  )

  /**
   * Applies a change. Changes with the same `key` in quick succession (dragging a slider)
   * become one undo step.
   */
  function update(change: (d: Draft) => void, key?: string) {
    if (!draft.value) return
    const now = Date.now()
    if (!key || key !== lastKey || now - lastAt > 800) {
      past.value = [...past.value.slice(-99), clone(draft.value)]
      future.value = []
    }
    lastKey = key ?? null
    lastAt = now
    const next = clone(draft.value)
    change(next)
    draft.value = next
    scheduleSave()
  }

  function undo() {
    const prev = past.value.at(-1)
    if (!prev || !draft.value) return
    future.value = [clone(draft.value), ...future.value]
    past.value = past.value.slice(0, -1)
    draft.value = prev
    lastKey = null
    scheduleSave()
  }

  function redo() {
    const next = future.value[0]
    if (!next || !draft.value) return
    past.value = [...past.value, clone(draft.value)]
    future.value = future.value.slice(1)
    draft.value = next
    lastKey = null
    scheduleSave()
  }

  function scheduleSave() {
    saveState.value = 'unsaved'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 700)
  }

  async function save() {
    if (!draft.value || saveState.value === 'conflict') return
    clearTimeout(saveTimer)
    saveState.value = 'saving'
    const sent = clone(draft.value)
    try {
      const clip = await $fetch<ClipDto>(`/api/clips/${toValue(id)}`, {
        method: 'PUT',
        body: { version: version.value, title: sent.title, startMs: sent.startMs, endMs: sent.endMs, edit: sent.edit },
      })
      version.value = clip.version
      if (data.value) data.value = { ...data.value, clip }
      // Edits made while saving are still unsaved.
      saveState.value = JSON.stringify(sent) === JSON.stringify(toRaw(draft.value)) ? 'saved' : 'unsaved'
      if (saveState.value === 'unsaved') scheduleSave()
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      saveState.value = status === 409 ? 'conflict' : 'error'
      toast.add({
        title: status === 409 ? 'Changed somewhere else' : 'Could not save',
        description: (e as Error).message,
        color: 'error',
        actions: status === 409 ? [{ label: 'Reload', onClick: () => void reload() }] : [{ label: 'Retry', onClick: () => void save() }],
      })
    }
  }

  async function reload() {
    draft.value = null
    version.value = 0
    past.value = []
    future.value = []
    await refresh()
  }

  onBeforeUnmount(() => {
    if (saveState.value === 'unsaved') void save()
  })

  // ── Derived timeline ──────────────────────────────────────────────
  const words = computed<Word[]>(() => data.value?.words ?? [])
  const range = computed(() => ({ start: draft.value?.startMs ?? 0, end: draft.value?.endMs ?? 0 }))
  const cuts = computed(() => (draft.value ? effectiveCuts(words.value, range.value, draft.value.edit.trim) : []))
  const segments = computed(() => keptSegments(range.value, cuts.value))
  const duration = computed(() => outputDuration(segments.value))
  const captionWords = computed(() =>
    draft.value
      ? wordsToOutput(words.value, segments.value, { keywords: data.value?.clip.keywords, emojis: draft.value.edit.emojis })
      : [],
  )

  // ── Faces (for "follow faces") ──────────────────────────────────
  const faceTrack = shallowRef<FaceTrack | null>(null)
  watch(
    () => data.value?.project.assets.faces?.updatedAt,
    async (stamp) => {
      const projectId = data.value?.project.id
      if (!stamp || !projectId) return
      try {
        faceTrack.value = await $fetch<FaceTrack>(`/api/projects/${projectId}/faces`)
      } catch {
        faceTrack.value = null
      }
    },
    { immediate: true },
  )
  /** The layout as drawn: with "follow faces" on, its path comes from the face track. */
  const layout = computed(() => (draft.value ? resolveLayout(draft.value.edit.layout, faceTrack.value, range.value) : null))
  const coverage = computed(() => (faceTrack.value ? faceCoverage(faceTrack.value, range.value) : null))

  return {
    data,
    error,
    faceTrack,
    layout,
    coverage,
    refresh,
    draft,
    version,
    saveState,
    canUndo: computed(() => past.value.length > 0),
    canRedo: computed(() => future.value.length > 0),
    update,
    undo,
    redo,
    save,
    reload,
    words,
    cuts,
    segments,
    duration,
    captionWords,
  }
}

export type ClipEditor = ReturnType<typeof useClipEditor>
