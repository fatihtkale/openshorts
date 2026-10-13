import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The web app and the worker share one .env at the repo root.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxt/ui'],
  // Client-only pages: the app runs on the user's own Mac, so server rendering buys nothing, and it rendered dates in
  // the server's locale and time zone (hydration mismatches). Server routes (API, /mcp, OAuth callbacks) are unaffected.
  ssr: false,
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  devServer: {
    // Local-only by default: the app holds OAuth tokens and file access.
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
  },
  app: {
    head: { title: 'Clip Studio' },
  },
})
