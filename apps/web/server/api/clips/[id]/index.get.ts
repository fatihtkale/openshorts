/** Everything the clip editor needs: the clip, its project, the words around it, and its exports. */
export default defineEventHandler((event) =>
  withProjectErrors(() => {
    const { clips, projects, transcripts, renders } = useCore()
    const clip = clips.require(getRouterParam(event, 'id')!)
    const project = projects.getDto(clip.projectId)
    const all = transcripts.get(clip.projectId)?.words ?? []
    // Words from 30 s before to 30 s after, so the clip can be extended in the editor.
    const from = clip.startMs - 30_000
    const to = clip.endMs + 30_000
    const words = all.filter((w) => w.end > from && w.start < to)
    return { clip, project, words, renders: renders.listForClip(clip.id) }
  }),
)
