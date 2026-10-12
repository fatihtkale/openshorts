/** An expected failure with a message fit for the user; the API maps `code` to an HTTP status. */
export class ProjectError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'conflict' | 'invalid',
  ) {
    super(message)
  }
}
