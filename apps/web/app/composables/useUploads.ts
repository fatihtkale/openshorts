import type { ProjectDto } from '@clipstudio/core/shared'

export interface UploadState {
  loaded: number
  total: number
  error: string | null
}

const xhrs = new Map<string, XMLHttpRequest>()
let unloadGuard = false

/** File uploads in progress, by project id. Lives in the browser tab: leaving the page stops them. */
export function useUploads() {
  const uploads = useState<Record<string, UploadState>>('uploads', () => ({}))
  const toast = useToast()

  function set(id: string, state: UploadState | null) {
    const next = { ...uploads.value }
    if (state) next[id] = state
    else delete next[id]
    uploads.value = next
    guardUnload()
  }

  function guardUnload() {
    if (unloadGuard || !import.meta.client) return
    unloadGuard = true
    window.addEventListener('beforeunload', (e) => {
      if (xhrs.size > 0) e.preventDefault()
    })
  }

  /** Creates the project, then streams the file to it. Resolves with the project once the upload is done. */
  async function upload(file: File, name: string): Promise<ProjectDto> {
    const project = await $fetch<ProjectDto>('/api/projects/upload', { method: 'POST', body: { name, filename: file.name } })
    set(project.id, { loaded: 0, total: file.size, error: null })

    return new Promise<ProjectDto>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhrs.set(project.id, xhr)
      xhr.open('PUT', `/api/projects/${project.id}/source?filename=${encodeURIComponent(file.name)}`)
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.upload.onprogress = (e) => set(project.id, { loaded: e.loaded, total: e.total || file.size, error: null })
      xhr.onload = () => {
        xhrs.delete(project.id)
        if (xhr.status >= 200 && xhr.status < 300) {
          set(project.id, null)
          resolve(JSON.parse(xhr.responseText) as ProjectDto)
        } else {
          set(project.id, null)
          reject(new Error(`Upload of ${file.name} failed`))
        }
      }
      xhr.onerror = xhr.onabort = () => {
        xhrs.delete(project.id)
        set(project.id, null)
        reject(new Error(`Upload of ${file.name} stopped`))
      }
      xhr.send(file)
    }).catch((error: Error) => {
      toast.add({ title: error.message, color: 'error', icon: 'i-lucide-upload' })
      throw error
    })
  }

  function cancel(projectId: string) {
    xhrs.get(projectId)?.abort()
  }

  return { uploads, upload, cancel }
}
