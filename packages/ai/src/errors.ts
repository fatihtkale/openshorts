/** A failure the user can act on (wrong key, model missing, nothing usable). The message is shown as is. */
export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}
