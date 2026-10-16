import { publishPost } from '@clipstudio/social'
import type { HandlerDeps, JobHandler } from './index'

/** Uploads an export to YouTube or TikTok. Only ever queued after the user confirmed the post. */
export function createPublishHandler({ posts, accounts, renders, clips, storage, socialApps }: HandlerDeps): JobHandler<'post.publish'> {
  return async ({ postId }, ctx) => {
    const post = posts.get(postId)
    if (!post) throw new Error('This post no longer exists.')
    const render = renders.get(post.renderId)
    if (!render?.storageKey || !render.bytes) throw new Error('The exported video is missing.')

    ctx.progress(0, 'Connecting')
    const result = await publishPost(
      { posts, accounts, apps: socialApps },
      postId,
      {
        path: await storage.localPath(render.storageKey),
        bytes: render.bytes,
        mimeType: 'video/mp4',
        longForm: clips.require(render.clipId).origin === 'compilation',
      },
      { signal: ctx.signal, onProgress: (f, message) => ctx.progress(f, message) },
    )
    return result
  }
}
