# CLAUDE.md

Clip Studio: a local-first app that turns long videos into short vertical clips and schedules them to TikTok/YouTube.
Two users, one Mac each. [PLAN.md](PLAN.md) is the source of truth for scope and phases; [README.md](README.md) for setup and layout.

## Commands

```bash
pnpm dev          # web (:3000) + worker
pnpm test         # vitest, all packages
pnpm typecheck    # every package, including nuxt typecheck
pnpm build        # production build of apps/web
pnpm db:generate  # after editing packages/core/src/db/schema.ts (use --name <slug> via drizzle-kit for readable names)
```

Run `pnpm test` and `pnpm typecheck` before calling a change done.

## Rules

- **AI proposes, the user confirms.** Anything with a side effect (download, render, publish, schedule, delete) needs a
  confirm step in the UI. Claude/MCP tools may only create proposals, never approve them.
- **Heavy work is a job**, never inside a request handler. Define it in `packages/core/src/shared/jobs.ts`, handle it in
  `apps/worker/src/handlers/` (registered in `handlers/index.ts`). Handlers must honour `ctx.signal` and report `ctx.progress`.
- **Storage keys, not paths.** Files go through the `Storage` interface; the DB stores keys like `projects/<id>/source.mp4`.
- **Times are UTC** in the DB; the timezone is stored separately.
- Server routes stay thin: logic lives in `packages/core` (or `packages/media` for tool wrappers) so the worker and MCP can reuse it.
- `@clipstudio/core/shared` is the only core entry the browser may import (no Node/DB deps). Type-only imports are fine anywhere.
- Secrets stay server-side and out of git. Never print `.env` values.

## Machine notes

- macOS on Apple Silicon (M1 Pro, 16 GB). Heavy job groups (`transcribe`, `render`) run one at a time.
- Node 22.19 is installed; Nuxt 4.6 wants 22.21+ or 24 (it warns but runs). better-sqlite3 is pinned to v12 because v13 has no
  prebuilt binary for Node 22 and Xcode can't compile here.
- ffmpeg, yt-dlp and whisper-cpp come from Homebrew; System check (`/system`) reports what's missing.
  Homebrew's yt-dlp pulls in Deno, which yt-dlp needs to solve YouTube's JS challenges.
- YouTube section downloads (`--download-sections`) fail now and then with "ffmpeg exited with code 8"; the job retry covers it.
- Use a Creative Commons video for manual download tests (e.g. Blender's Big Buck Bunny, `aqz-KE-bpKQ`).

## Project files

`data/storage/projects/<id>/`: `source.<ext>` (original), `proxy.mp4` (720p H.264 preview, 1 s keyframes),
`audio.wav` (16 kHz mono, for whisper), `thumbnail.jpg`. Rows in `assets` point at them by storage key.
Project status: `importing` (download/upload) → `processing` (`media.prepare`) → `ready`, or `failed` with a retry.

Transcripts live in the `transcripts` table (one per project, words as JSON with ms timings and confidence).
`media.prepare` queues `transcribe` automatically when a model is installed. Whisper models live in `data/models/`
(`ModelService` decides which one is active); `downloadFile` verifies Hugging Face's SHA-256 and resumes `.partial` files.
whisper-cli runs with `-ml 1 -sow` (one segment per word); keep flash attention on, so don't add `-dtw`.

## Testing notes

- For speech, make a clip locally: `say -o speech.aiff "…"` plus an ffmpeg test pattern. Big Buck Bunny has no dialogue.
- Known Whisper quirk: a closing "Thanks for watching." after other speech is dropped (it transcribes fine on its own,
  and other closing lines come through). Padding and decoder flags (`-mc 0`, `-bs 1`, `-nth`, `-tp`) don't help.
  A possible fix later: re-transcribe speech the words don't cover (silencedetect gaps), one gap per whisper run.
- The worker re-checks for orphaned jobs every 15 s, so a killed dev server doesn't leave jobs stuck as running.
