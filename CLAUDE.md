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
pnpm test:e2e     # build + Playwright in system Chrome, app on :3100 with e2e/.data (never touches data/)
pnpm checkup      # setup check (`pnpm doctor` is pnpm's own command, hence the name)
pnpm fix:sqlite   # after switching Node versions: fetch the matching better-sqlite3 build
pnpm backup / pnpm restore
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
- The web app is client-only (`ssr: false`): dates render in the viewer's locale and time zone, no hydration step.
- Nuxt 4's `useFetch` data is a shallow ref: pass `deep: true` when a form edits its fields in place (`v-model="data.x"`).
- `@clipstudio/core/shared` is the only core entry the browser may import (no Node/DB deps). Type-only imports are fine anywhere.
- Secrets stay server-side and out of git. Never print `.env` values.
- The in-app Guide (`apps/web/app/pages/guide.vue`, components in `components/guide/`) is the user manual. When a feature,
  label, shortcut or setup step changes, update it too. It reads numbers and names from shared constants where it can.

## Machine notes

- macOS on Apple Silicon (M1 Pro, 16 GB). Heavy job groups (`transcribe`, `render`) run one at a time.
- Node 24.21 (Herd's nvm, picked by `.nvmrc`; the user's Terminal switches automatically). Agent shells default to
  Node 22.19: put `~/Library/Application Support/Herd/config/nvm/versions/node/v24.21.0/bin` first on PATH before
  running tests or the app. better-sqlite3 (v12, prebuilt only: Xcode can't compile here) is built for one Node version;
  after a switch, `pnpm fix:sqlite` fetches the matching build (`pnpm rebuild` doesn't). `pnpm checkup` detects it.
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
Whisper glues each word's start to the previous word's end, so words after a pause start early (captions showed them
before they were said). `transcribe` therefore runs `alignToAudio` (packages/media `align.ts`): a 20 ms
`loudnessEnvelope`, `speechMap` (quiet / speech / unclear per frame, judged against the local quiet floor), then
`alignWords` trims quiet off word edges and moves words stamped in the quiet into the next speech (or a sentence tail
back into its own). Unclear audio (music bed, no quiet floor) is left alone. `transcript.retime` / `pnpm retime` redo
existing transcripts (`TranscriptService.retime` keeps text fixes). Exports made before keep their old captions.

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
- Follow faces: `media.faces` (on request only: "Find faces" in the Layout tab; not queued on import) samples the preview at 5/s, runs UltraFace RFB-320
  (onnxruntime-node, model fetched once into `data/models/` and checked by SHA-256) and stores `faces.json`
  (boxes per sample + scene cuts). `resolveLayout`/`autoFrame` turn it into a smoothed crop path; new clips default
  to `layout.auto = true`. `pnpm --filter @clipstudio/worker exec tsx src/dev/faces.ts <projectId> <ms> <w> <h> --sheet`
  draws detections to `data/dev/faces-sheet.jpg`.
- Layout modes: fill, fit, split, screen. Screen (`screenPanels`) keeps a screen recording at full width (480–1152 px
  tall) and fills the rest with a face window; `layout.screen` is optional (older clips) and falls back to
  `DEFAULT_SCREEN`. `facecamWindow` places the face window from the face track (face ≈ 40% of its height, zoom ≤ 8).
- `snapToWords` only moves an edge that falls inside a word; edges in silence stay (visual moments aren't trimmed).
  It ignores "words" longer than `MAX_REAL_WORD_MS` (2 s): over music, whisper writes things like "Thank you." stretched
  across 30 s, and snapping to those turned 15 s clips into 40 s ones.

## Posting (YouTube, TikTok)

- `packages/social`: OAuth (PKCE; TikTok uses Login Kit for **Desktop**, hex SHA-256 challenge, localhost redirect),
  profile, YouTube resumable upload, TikTok chunked upload (files ≤ 64 MB in one chunk) + status polling, `publishPost`.
  Base URLs are injectable; `social.test.ts` runs everything against a fake server.
- Accounts: `AccountService`, tokens AES-256-GCM sealed with `loadSecretKey` (env `SECRET_KEY` or `data/secret.key`).
  `accessToken()` refreshes 2 min before expiry and marks the account `needs_reconnect` when the platform refuses.
- Posts: `PostService.create` validates, then queues `post.publish`. Errors with `retryable: false` fail without retries
  (no duplicate posts); a TikTok post already uploaded (`status=processing` + `remoteId`) resumes polling only.
- Editing text after scheduling: `PostService.checkText`/`saveText` + social `editPostText` (`PATCH /api/posts/:id`).
  Waiting posts change locally; YouTube videos (scheduled/published) are updated via `videos.update` first (needs the
  `youtube.force-ssl` scope, so older sign-ins reconnect once: `AccountDto.canEditVideos`). TikTok can't be edited once up.
  Moving a scheduled YouTube video (`reschedulePost`) sets `status.publishAt` via `videos.update` first, then `saveMove`
  stores it and re-plans the `post.stats` checks. Uploads use category 24 (Entertainment, `YOUTUBE_CATEGORY_ID`) and, by
  default, no hashtags, tags or description (`suggestPostText`, see docs/shorts-playbook.md).
  "Related video" isn't in YouTube's API: `youtube.relatedVideo` is a reminder shown next to `youtubeStudioUrl`.
  Default hashtags: `ScheduleDefaults.hashtags` → `suggestPostText(..., defaultHashtags)` (casing kept, put first).
- TikTok UX rules followed in `PostModal.vue`: creator info fetched before posting, privacy has no default,
  interaction switches, commercial-content disclosure, music-usage consent line. Unaudited apps: SELF_ONLY + private accounts.

## Scheduling

- `shared/schedule.ts` is the maths (browser + server): `zonedToUtc` (Intl-based, DST-safe), `planTimes`
  (edges / centred / custom, round 5 min, seeded jitter, skips passed times today), `scheduleWarnings`.
  Defaults: US audience, America/New_York, 12:00–21:00, edge to edge (settings key `schedule.defaults`).
- `planDays` splits a batch over days (`perDay`, default 3) and, with `after`, continues from the last waiting post
  (fills its day when there's room `minGapMin` after it, else the next day). The scheduler picks "after what's already
  scheduled" by default when the chosen accounts have waiting posts (`queued`/`uploading`/`processing`/`scheduled`).
- `PostService.createBatch` validates every post then saves all in one transaction (`schedule_batches`).
  YouTube: the job runs now and uploads private + `publishAt` (scheduled posts are always public at the time).
  TikTok: the job's `runAt` is the time. A TikTok post more than 10 min late is `missed`, never posted silently.
- The worker runs `caffeinate -i -m` while TikTok posts are due within 12 h.
- Insights: when a post goes `published`/`scheduled`, `PostService.setStatus` queues `post.stats` at live + 48 h and
  + 7 d (`collectPostStats` → `post_stats`, `ageHours` = hours since live). TikTok needs the `video.list` scope (Display
  API); older TikTok sign-ins are skipped until reconnected. After TikTok publishes, `remoteId` is the video id.
  `shared/insights.ts` scores each post as views ÷ its account's median two-day views and suggests a same-length window
  only with ≥ 10 measured posts, ≥ 5 in the window, and ≥ 15 % lift; applying it is a confirmed settings change.
- Claude's `propose_schedule` creates a `schedule` proposal; the Inbox opens `/schedule?proposal=…` pre-filled.

## Claude / MCP

- **Finding, cutting or judging clips? Read [docs/claude-clipping-guide.md](docs/claude-clipping-guide.md) first**: the batch
  workflow (read every transcript, check frames, sweep talk-only footage), the quality bar, what to reject, and what
  worked on this channel. Claude Desktop users add it to a Project's knowledge.
- `packages/mcp` builds the server (tools + `SERVER_INSTRUCTIONS`, the clip-finding guide every client receives);
  `apps/web/server/routes/mcp.ts` serves it stateless at `/mcp` (one server per request, JSON responses).
- Tools either read or create a proposal (`ProposalService`). There is no approve tool: decisions only happen in the Inbox UI.
- `server/middleware/00.security.ts` rejects unknown Host headers (DNS rebinding) and cross-site Origins on mutating
  `/api` and `/mcp` requests. There is no MCP token; the app binds to 127.0.0.1. `ALLOWED_HOSTS` adds hosts if ever needed.
- Test the endpoint with curl: POST JSON-RPC with `accept: application/json, text/event-stream`.

## Twitch (VODs and clips)

- Links: `parseVideoLink` (YouTube video, `twitch.tv/videos/<id>` → id `v<id>`, `twitch.tv/<ch>/clip/<slug>` /
  `clips.twitch.tv/<slug>` → slug). Same preview/import routes as YouTube (`/api/projects/youtube/*`); projects get
  `sourceType: 'twitch'` and `sourceMeta.twitch.kind`. yt-dlp handles both; `importRange` records a partial download.
- Twitch clips import whole; `media.prepare` makes one approved clip with origin `imported` (`createImported`);
  `sourceMeta.autoEvaluate` (a choice with its cost in the import dialog) queues `clips.evaluate` after transcription.
- Highlights (`media.highlights`, after prepare for VODs and videos ≥ 10 min): `loudnessCurve` (per-second dBFS from
  audio.wav) + Helix viewer clips (`TWITCH_CLIENT_ID/SECRET`, app token, `twitchVodClips` filtered by video id, offsets
  shifted by `importRange`). `findHotSpots` ranks them (viewer clips 65 %, loudness lift 35 %; spots start 3 s early).
  Loudness only works where a voice rides over the audio: edited videos with a constant music bed give little.
- Smart import: `/api/projects/twitch/moments` → `groupMoments` (clips within 30 s merged, −60/+30 s context) → one
  partial-download project per picked moment. MCP: `get_highlights`.
- Sources: small creators who agreed to being clipped.

## Clip evaluation (the Shorts rubric)

- [docs/shorts-playbook.md](docs/shorts-playbook.md) is the background (what YouTube measures, hooks, endings, posting,
  policy), distilled from a Shorts course. Its clip rules are already in `CLIP_RUBRIC` / `CLIP_PICKING_RULES`.

- `shared/evaluation.ts` holds `CLIP_RUBRIC` (4 pillars: hook 40 %, pacing 30 %, payoff 20 %, standalone 10 %, plus the
  mute test), the 22–45 s sweet spot (`lengthAdvice`: warn under 15 s and over 50 s) and `trimLeadIn`. The rubric goes
  into the MCP instructions and every in-app prompt, so all evaluators judge the same way.
- `clips.evaluation` (JSON) is a note: `ClipService.checkEvaluation` computes the total itself (never trusts the model's
  arithmetic), snaps suggested edges to words and drops suggestions within 0.3 s. `score` = 10 × total.
  `setEvaluation` doesn't bump the clip version; a suggested trim only moves the clip when the user applies it
  (editor: undoable edit; Inbox: "Approve trimmed" → `applySuggestedTrim`). `evaluationState` says current/trimmed/stale.
- Lead-in rule (user's standing request): clips start 1–3 s (max 5) before the key moment, which lands 1–5 s in; never
  open on the impact/climax. It's in `CLIP_PICKING_RULES` and the rubric's hook pillar, so every evaluator applies it.
- Proposals from models get `trimLeadIn`: an opening greeting sentence and up to four filler words are cut, unless that
  leaves under 15 s or under half the clip. Manual clips are never trimmed.
- Evaluators: Claude via MCP (`propose_clips` with `evaluation`, `evaluate_clip` for existing clips, `evaluate_clips`
  prompt), and in-app `clips.evaluate` (Claude also gets four frames per clip for the mute test; Ollama is text-only).

## In-app AI (optional)

- `packages/ai`: `findClips` builds one prompt (timed sentences + existing clips + `CLIP_PICKING_RULES`, shared with the MCP
  instructions) and asks Claude (`@anthropic-ai/sdk`, streamed, structured output, adaptive thinking, effort high,
  `fallbacks: "default"` on Opus/Sonnet) or Ollama (`/api/chat` with a JSON-schema `format`). Picks go through
  `ProposalService.proposeClips`, so they land in the Inbox like Claude's.
- Settings key `ai.settings` (`core/src/ai.ts`); the Anthropic key is sealed with the secret key and only unsealed by the
  worker (`aiCredentials`), falling back to `ANTHROPIC_API_KEY`. The browser only sees `hasAnthropicKey`.
- `clips.find` runs once (`maxAttempts: 1`): a retry costs money. The UI shows a cost estimate (`estimateFindCost`) before.
- Tests use fake Anthropic (SSE) and Ollama servers; never call the real API in tests.

## Backups

- `core/src/backup.ts`: SQLite online backup (`$client.backup`) + `secret.key` into `data/backups`; the worker runs
  `autoBackup` hourly (one snapshot a day, 14 automatic kept; manual and `before-restore` never pruned).
  `restore` refuses while the app runs (heartbeat or port), validates the file, snapshots first, removes old WAL files.
- CLI scripts live in `apps/worker/src/cli/`; pnpm runs them from `apps/worker`, so user paths resolve from `INIT_CWD`.

## Testing notes

- E2E (`e2e/`): the config resets `e2e/.data` once per run (guarded by an env marker, since Playwright reloads the
  config in workers), symlinks `data/models` for whisper, and generates a `say` + ffmpeg talk with a greeting.

- For speech, make a clip locally: `say -o speech.aiff "…"` plus an ffmpeg test pattern. Big Buck Bunny has no dialogue.
- Known Whisper quirk: a closing "Thanks for watching." after other speech is dropped (it transcribes fine on its own,
  and other closing lines come through). Padding and decoder flags (`-mc 0`, `-bs 1`, `-nth`, `-tp`) don't help.
  A possible fix later: re-transcribe speech the words don't cover (silencedetect gaps), one gap per whisper run.
- The worker re-checks for orphaned jobs every 15 s, so a killed dev server doesn't leave jobs stuck as running.
