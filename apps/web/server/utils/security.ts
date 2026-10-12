/**
 * Host names the app answers to. A page on another site could otherwise reach this
 * local server through DNS rebinding; checking the Host header blocks that.
 */
export function allowedHosts(): string[] {
  const { config } = useCore()
  const extra = (process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)
  return [`127.0.0.1:${config.port}`, `localhost:${config.port}`, `[::1]:${config.port}`, ...extra]
}

export function appUrl(): string {
  return useCore().config.appUrl
}
