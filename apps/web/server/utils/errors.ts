import { ProjectError } from '@clipstudio/core'

const STATUS: Record<ProjectError['code'], number> = { not_found: 404, conflict: 409, invalid: 400 }

/** Runs `fn`, turning ProjectError into the matching HTTP error with its message. */
export async function withProjectErrors<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ProjectError) {
      throw createError({ statusCode: STATUS[error.code], statusMessage: error.message })
    }
    throw error
  }
}
