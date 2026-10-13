# Clip Studio

Turns long videos into short vertical clips with animated captions, and schedules them to TikTok and YouTube.
Runs locally on a Mac. Claude connects over MCP and does the AI work; you confirm everything in the app.

The full plan is in [PLAN.md](PLAN.md).

## Setup

Requirements: macOS, Node 22.21+ (Node 24 recommended), pnpm 10, Homebrew.

```bash
brew install ffmpeg yt-dlp whisper-cpp
cp .env.example .env
pnpm install
pnpm dev
```

Open http://127.0.0.1:3000 and go to **System check**. It shows what's installed and has a test job
for checking that the background worker runs.

## Connect Claude

With `pnpm dev` running, open Claude Code in this folder: `.mcp.json` points it at `http://127.0.0.1:3000/mcp`
(approve "clipstudio" when asked). Settings → Connect Claude in the app has the command for other folders and
the config for Claude Desktop. Then ask: "Find the best clips in my latest Clip Studio project".
Claude can read everything and propose clips or imports; you approve them in the Inbox.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Starts the web app (:3000) and the worker together |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` | Type-checks every package |
| `pnpm build` / `pnpm start` | Production build of the web app; `start` runs it with the worker |
| `pnpm db:generate` | Creates a migration after you change `packages/core/src/db/schema.ts` |

## Layout

```
apps/web        Nuxt 4 app: pages, components, server API (thin; calls packages/core)
apps/worker     Background process: claims jobs from the queue and runs them
packages/core   Database (SQLite + Drizzle), job queue, storage, config, shared types
packages/media  Wrappers around ffmpeg, yt-dlp and whisper.cpp
packages/mcp    The MCP server Claude connects to (served by the web app at /mcp)
packages/captions  Caption engine, presets, layouts and the cut timeline; runs in the browser and in the exporter
packages/social YouTube and TikTok sign-in, uploads and view counts
packages/ai     Optional in-app "Find clips" (Claude API key or a local Ollama model)
data/           (gitignored) the database and all media files
```

### How background work flows

1. The web app adds a row to the `jobs` table (`queue.enqueue`).
2. The worker claims it, runs the handler from `apps/worker/src/handlers/`, and reports progress.
3. Every write bumps the job's `rev`. `/api/events` streams changes after a given `rev` to the browser (SSE).
4. The activity tray (top right) shows them live. Failed jobs retry with backoff; you can cancel or retry by hand.

### Adding a job type

1. Define it in `packages/core/src/shared/jobs.ts` (label, concurrency group, attempts, zod payload).
2. Add its handler in `apps/worker/src/handlers/` and register it in `handlers/index.ts`. TypeScript fails until every type has one.
3. Enqueue it from a server route with `useCore().queue.enqueue(...)`.
