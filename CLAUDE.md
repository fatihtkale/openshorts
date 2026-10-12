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
- Use a Creative Commons video for manual download tests (e.g. Blender's Big Buck Bunny, `aqz-KE-bpKQ`;
  for faces, Tears of Steel `R6MlUcmOul8`, CC-BY 3.0, close-ups around 0:58–1:05).

## Project files

`data/storage/projects/<id>/`: `source.<ext>` (original), `proxy.mp4` (720p H.264 preview, 1 s keyframes),
`audio.wav` (16 kHz mono, for whisper), `thumbnail.jpg`. Rows in `assets` point at them by storage key.
Project status: `importing` (download/upload) → `processing` (`media.prepare`) → `ready`, or `failed` with a retry.

Transcripts live in the `transcripts` table (one per project, words as JSON with ms timings and confidence).
`media.prepare` queues `transcribe` automatically when a model is installed. Whisper models live in `data/models/`
(`ModelService` decides which one is active); `downloadFile` verifies Hugging Face's SHA-256 and resumes `.partial` files.
whisper-cli runs with `-ml 1 -sow` (one segment per word); keep flash attention on, so don't add `-dtw`.

## Editor and export

- `packages/captions` is browser-safe and shared: `drawCaptions`/`drawHook` (engine), presets, layout maths
  (`fillRect`, `panelRect`), and the cut timeline (`effectiveCuts`, `keptSegments`, `wordsToOutput`).
  The editor preview (`components/editor/ClipCanvas.vue`) and the exporter (`packages/media/src/render.ts`) both use it.
- A clip's look is `clips.edit` (a `ClipEdit`, validated by `clipEditSchema`); `clips.version` goes up on every save
  and each render records the version it shows.
- Export: ffmpeg cuts/crops/encodes (`select` for cuts, `sendcmd` to move the fill crop, VideoToolbox with x264 fallback);
  Node draws caption frames with `@napi-rs/canvas` and pipes them in as raw RGBA. ~3× real time on the M1 Pro.
- Fonts come from Fontsource (woff2): the browser imports their CSS, the exporter registers the same files.
- `pnpm --filter @clipstudio/worker caption-sheet` draws every preset to `data/dev/caption-sheet.png` for a quick look.
- Follow faces: `media.faces` (queued after `media.prepare`) samples the preview at 5/s, runs UltraFace RFB-320
  (onnxruntime-node, model fetched once into `data/models/` and checked by SHA-256) and stores `faces.json`
  (boxes per sample + scene cuts). `resolveLayout`/`autoFrame` turn it into a smoothed crop path; new clips default
  to `layout.auto = true`. `pnpm --filter @clipstudio/worker exec tsx src/dev/faces.ts <projectId> <ms> <w> <h> --sheet`
  draws detections to `data/dev/faces-sheet.jpg`.
- `snapToWords` only moves an edge that falls inside a word; edges in silence stay (visual moments aren't trimmed).

## Posting (YouTube, TikTok)

- `packages/social`: OAuth (PKCE; TikTok uses Login Kit for **Desktop**, hex SHA-256 challenge, localhost redirect),
  profile, YouTube resumable upload, TikTok chunked upload (files ≤ 64 MB in one chunk) + status polling, `publishPost`.
  Base URLs are injectable; `social.test.ts` runs everything against a fake server.
- Accounts: `AccountService`, tokens AES-256-GCM sealed with `loadSecretKey` (env `SECRET_KEY` or `data/secret.key`).
  `accessToken()` refreshes 2 min before expiry and marks the account `needs_reconnect` when the platform refuses.
- Posts: `PostService.create` validates, then queues `post.publish`. Errors with `retryable: false` fail without retries
  (no duplicate posts); a TikTok post already uploaded (`status=processing` + `remoteId`) resumes polling only.
- TikTok UX rules followed in `PostModal.vue`: creator info fetched before posting, privacy has no default,
  interaction switches, commercial-content disclosure, music-usage consent line. Unaudited apps: SELF_ONLY + private accounts.

## Claude / MCP

- `packages/mcp` builds the server (tools + `SERVER_INSTRUCTIONS`, the clip-finding guide every client receives);
  `apps/web/server/routes/mcp.ts` serves it stateless at `/mcp` (one server per request, JSON responses).
- Tools either read or create a proposal (`ProposalService`). There is no approve tool: decisions only happen in the Inbox UI.
- `server/middleware/00.security.ts` rejects unknown Host headers (DNS rebinding) and cross-site Origins on mutating
  `/api` and `/mcp` requests. There is no MCP token; the app binds to 127.0.0.1. `ALLOWED_HOSTS` adds hosts if ever needed.
- Test the endpoint with curl: POST JSON-RPC with `accept: application/json, text/event-stream`.

## Testing notes

- For speech, make a clip locally: `say -o speech.aiff "…"` plus an ffmpeg test pattern. Big Buck Bunny has no dialogue.
- Known Whisper quirk: a closing "Thanks for watching." after other speech is dropped (it transcribes fine on its own,
  and other closing lines come through). Padding and decoder flags (`-mc 0`, `-bs 1`, `-nth`, `-tp`) don't help.
  A possible fix later: re-transcribe speech the words don't cover (silencedetect gaps), one gap per whisper run.
- The worker re-checks for orphaned jobs every 15 s, so a killed dev server doesn't leave jobs stuck as running.
