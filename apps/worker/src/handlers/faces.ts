import { getConfig, projectPrefix } from '@clipstudio/core'
import { detectFaces, ensureFaceModel } from '@clipstudio/media'
import type { HandlerDeps, JobHandler } from './index'

/** Finds faces through the whole video, so vertical crops can follow them. Stored as faces.json. */
export function createFacesHandler({ projects, storage }: HandlerDeps): JobHandler<'media.faces'> {
  return async ({ projectId }, ctx) => {
    const project = projects.require(projectId)
    const proxy = projects.asset(projectId, 'proxy')
    if (!proxy || !project.width || !project.height || !project.durationMs) throw new Error('The preview copy is missing.')

    ctx.progress(0, 'Getting the face model')
    const modelPath = await ensureFaceModel(getConfig().modelsDir, ctx.signal)
    const track = await detectFaces({
      src: await storage.localPath(proxy.storageKey),
      width: project.width,
      height: project.height,
      durationMs: project.durationMs,
      modelPath,
      signal: ctx.signal,
      onProgress: (f) => ctx.progress(f, 'Looking for faces'),
    })

    const key = `${projectPrefix(projectId)}/faces.json`
    const json = JSON.stringify(track)
    await storage.put(key, json)
    projects.setAsset(projectId, 'faces', key, Buffer.byteLength(json), 'application/json')
    const withFaces = track.frames.filter((f) => f.length).length
    return { samples: track.frames.length, withFaces, cuts: track.cuts.length }
  }
}
