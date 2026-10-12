# Clip Studio — Build Plan

> A local-first app that turns long videos into short vertical clips, captions them,
> and schedules them to TikTok and YouTube. Used by two people. **Claude is the brain, connected over MCP**,
> so there are no extra AI subscriptions. Built so it can move to a server later without a rewrite.

---

## 1. What "best" means for us

The bar is OpusClip. We beat it on the things a hosted SaaS can't do well:

| | OpusClip-style SaaS | Us |
|---|---|---|
| Cost | Per-minute credits | Your existing Claude subscription + free local transcription |
| AI | Their model, fixed | Claude (or any MCP client) drives the app; optional API keys/Ollama for one-click automation |
| Control | AI decides, you fix after | **AI proposes, you confirm.** Nothing happens without a yes, given in the app |
| Editing | Timeline trimming | Edit by text: delete words in the transcript to cut |
| Scheduling | One post at a time | Pick N clips and a day, and they're spread across the best hours of it |
| Automation | Clicking around | "Claude, make 5 clips about pricing and spread them over Friday" |
| Privacy | Uploads to their cloud | Files stay on your Mac |

---

## 2. Product principles (they shape every screen)

1. **AI proposes, human confirms.** Every action with a side effect (download, render, publish,
   schedule, delete) needs a confirm step **in the app UI** that shows exactly what will happen:
   which account, which time, which title, and public or private.
   Claude can create proposals but can never approve them.
2. **One obvious next step.** Each screen has one primary button. The flow is linear:
   *Add video → Find clips → Review → Edit → Schedule.*
3. **Nothing is lost.** Deletes go to an in-app Trash for 30 days. Edits keep versions. Renders are re-creatable.
4. **Background work is visible.** A global activity tray shows every running job with its progress, and lets you cancel or retry it.
5. **Preview = export.** The captions you see in the editor are drawn by the same code that burns them into the file.
6. **Fast for repeat use.** Keyboard shortcuts in review (`J/K` move, `A` approve, `R` reject, `E` edit), plus saved defaults and presets.

---

## 3. Architecture

### 3.1 Stack

| Layer | Choice | Why |
|---|---|---|
| App | **Nuxt 4** (Vue 3, TypeScript) | Your requirement; Nitro server routes are our API and our MCP endpoint |
| Styling/UI | **Tailwind CSS v4 + Nuxt UI** | Polished, accessible components; we build fast and still look premium |
| State | Pinia + `useFetch` | Standard Nuxt |
| Validation | zod | One schema shared by forms, API and MCP tool inputs |
| DB | **SQLite + Drizzle ORM** | Zero setup locally. Drizzle switches to Postgres when we go to a server |
| Jobs | SQLite-backed job queue + separate **worker process** | Heavy work never blocks the UI. Swappable for BullMQ/Redis on a server |
| Video | **ffmpeg** (VideoToolbox hardware encode on Apple Silicon) | Cut, crop, scale, encode |
| Download | **yt-dlp** | The only reliable YouTube downloader. Needs regular updates (one-click update in Settings) |
| Transcription | **whisper.cpp** (local, Metal-accelerated) | Free, private, word-level timestamps. Claude can't hear audio, so this stays local |
| AI | **MCP server** (`@modelcontextprotocol/sdk`, Streamable HTTP at `/mcp`) | Claude Code / Claude Desktop does the thinking: clip picking, titles, hooks, multi-step work |
| AI (optional) | Vercel AI SDK | Later: one-click "Find clips" without opening Claude, via an API key or local Ollama |
| Captions | Our own **Canvas caption engine** (`@napi-rs/canvas` on the server, `<canvas>` in the browser) | Same code for preview and export, any animation, no React/Remotion licence |
| Face tracking | onnxruntime-node + a small face-detection model | Auto-reframe in Node, no Python runtime |
| Tests | Vitest (unit), Playwright (e2e, later) | |

**No Python, no Docker.** The runtimes are Node, plus three native binaries (ffmpeg, yt-dlp, whisper.cpp)
installed with Homebrew.

### 3.2 Repo layout (pnpm workspace)

```
apps/
  web/            Nuxt app: pages, components, server/api routes, server/mcp (thin, they call packages/core)
  worker/         Long-running Node process: claims jobs, runs them, reports progress
packages/
  core/           DB schema (Drizzle), services, job definitions, proposals, storage interface, config
  media/          Wrappers: ffmpeg, ffprobe, yt-dlp, whisper.cpp (spawn + progress parsing)
  captions/       Caption engine: presets, layout, animations; runs in browser AND Node
  mcp/            MCP tool definitions (read tools + propose tools) over packages/core services
  social/         YouTube + TikTok OAuth and upload clients
.claude/
  skills/         Clip-editor skills for Claude: how to pick viral moments, write hooks, titles, hashtags
.mcp.json         Registers the app's MCP server, so opening this repo in Claude Code connects automatically
data/             (gitignored) sqlite db + projects/<id>/... media files
```

`pnpm dev` starts web and worker together. On a server later, they deploy as two services sharing Postgres, Redis and S3.

### 3.3 Server-ready rules (follow these from day 1)

- All file access goes through a `Storage` interface (`local` now, `s3` later). The DB stores **keys**, never absolute paths.
- All heavy work runs as a **job**, never inside a request handler.
- All times are stored in UTC, with the timezone stored separately.
- Secrets live server-side only and never reach the client bundle. OAuth tokens are encrypted at rest (AES-GCM, key from env).
- Config comes from env (`APP_URL`, OAuth redirect URIs, storage driver, DB URL).
- No app login for now (two trusted users). Rows carry `created_by` (you / your friend) for attribution.
- The web server binds to `127.0.0.1` locally; the MCP endpoint requires a local token.

### 3.4 Job pipeline

```
ingest.download (yt-dlp) ─┐
ingest.upload ────────────┴─> media.probe -> media.proxy (720p preview + audio.wav + thumbnail)
                                  -> transcribe (whisper.cpp) -> scenes.detect      [automatic]
                                                                         │
                     Claude reads transcript/frames via MCP ─> proposes clips
                                                                         │
                         you approve clips in the app  <─────────────────┘
                                  -> reframe.track (faces) -> render (crop + captions + hook)
                                  -> you confirm posts -> publish.youtube / publish.tiktok
```

- Jobs table: `type, payload, status, progress, attempts, run_at, locked_by, error, project_id`.
- Retries use backoff. Concurrency is 1 render + 1 transcription at a time on 16 GB (configurable).
- Progress reaches the UI over **SSE** (`/api/events`), which reads job state from the DB.

---

## 4. Features in detail

### 4.1 Projects (one source video = one project)

- **Dashboard**: grid of project cards (thumbnail, title, duration, status, clip count, scheduled count, added by), with search and sort.
- **New project**: one input that accepts a **YouTube link** or a **drag-and-dropped file**. Pasting several links creates several projects.
  - YouTube: show title, thumbnail and duration first (`yt-dlp --dump-json`), then **Confirm download**.
  - Choose quality (default best ≤1080p), with an optional time range (only download 10:00–40:00).
- Project page tabs: **Overview · Transcript · Clips · Exports · Posts**.
- Rename, archive, or delete (to Trash).

> Note: only download videos you own or have the rights to repurpose. Downloading other people's
> YouTube content is against YouTube's Terms.

### 4.2 Transcription

- whisper.cpp `large-v3-turbo` locally, with **word-level timestamps** (captions and text-editing need them).
  It starts automatically after ingest.
- Transcript editor: fix misheard words (captions inherit the fixes) and add speaker labels.
- Language auto-detect, with an override.
- Optional later: a cloud provider (OpenAI, Deepgram, ElevenLabs) for languages whisper handles poorly.

### 4.3 AI via MCP: Claude as the brain

The app exposes an **MCP server**. Claude Code (or Claude Desktop, or any MCP client) connects and does the
thinking with your existing Claude subscription. No API keys are needed for AI.

**Install, once per machine:**
```bash
claude mcp add --transport http clipstudio http://127.0.0.1:3000/mcp --header "Authorization: Bearer <token from Settings>"
```
(`.mcp.json` in the repo does this automatically when Claude Code is opened in the project folder.
Settings → **Connect Claude** shows the exact command and a copy button.)

**Read tools** (free to call):

| Tool | Returns |
|---|---|
| `list_projects`, `get_project` | Projects, status, durations |
| `get_transcript(project, from?, to?)` | Word-timed transcript (paged for long videos) |
| `search_transcript(project, query)` | Matching passages with timestamps |
| `get_frames(project, times[])` | Video frames as images, so Claude can *see* visual moments |
| `get_scenes(project)` | Scene cuts and silences, for clean boundaries |
| `list_clips`, `get_clip` | Clips with status and render state |
| `list_accounts`, `get_calendar(from, to)`, `get_quota` | Connected accounts, scheduled posts, YouTube quota left |
| `get_best_times(platform, date)` | The scheduling defaults (§4.7) |

**Propose tools** (create a proposal; nothing executes until you approve it in the app):

| Tool | Proposal |
|---|---|
| `propose_project(url \| file)` | Download / import a video |
| `propose_clips(project, clips[])` | Clips with `{start, end, title, hook, score, reason, keywords}` |
| `propose_edit(clip, changes)` | Trim, caption preset, layout, hook text |
| `propose_render(clips[])` | Render jobs |
| `propose_posts(renders[], accounts[], times[], texts)` | Titles, descriptions, hashtags, times |
| `propose_delete(...)` | Anything to Trash |

Each propose tool returns a link (`http://127.0.0.1:3000/inbox/<id>`). The **Inbox** in the app shows the proposal
with a full preview: video, times, texts, accounts. Then **Approve / Edit / Reject**. A multi-step plan (clips → render →
schedule) can be approved as one batch, but you see all of it first. There is no approve tool, so Claude cannot
approve its own work.

**Skills** in `.claude/skills/` teach Claude the editing craft: what makes a strong 15–60 s moment, hook formulas,
snapping to sentence boundaries, platform title/hashtag rules. So "find clips in my latest project" gives consistent results.

**Example:**
> "Make 5 clips about the pricing discussion from yesterday's video, use the Pop captions, and spread them over Friday on TikTok and YouTube."

Claude searches the transcript, looks at frames, and creates 3 proposals (clips, render, schedule). You review the
day timeline in the Inbox and approve.

**Optional in-app AI (Phase 7)**: a "Find clips" button that runs the same skill prompt through an API key (Claude/Gemini/OpenAI)
or local Ollama, for when you don't want to open Claude. Its results also land as proposals.

### 4.4 Clip review & editor

**Review screen**: proposed clips sorted by score, each with an inline preview, the reason it was picked, and Approve / Reject / Edit.
Nothing renders until you approve. You can also create clips by hand by selecting text in the transcript.

**Editor:**
- 9:16 preview with a toggle for **platform safe-zones** (the TikTok/YouTube UI overlays), so captions never sit under buttons.
- **Text-based trimming**: select words in the transcript to cut them. Handles extend the start and end.
- **Layout**: Fill (crop, auto face-follow), Fit (blurred background), later Split (2 speakers) and Screen (screencast + facecam).
- Crop keyframes: auto from face tracking, adjustable by dragging the crop box.
- **Hook overlay**: hook text for the first ~3 s. Editable, with styles.
- Undo/redo, plus versions.

### 4.5 Animated captions (OpusClip-level)

One engine (`packages/captions`): `draw(ctx, words, timeMs, preset)`. The browser preview and the server export call the same function.

**Presets at launch** (all editable, save your own):

| Preset | Effect |
|---|---|
| Karaoke | Line visible, active word changes colour |
| Pop | Each word scales in 80% → 110% → 100% |
| Box highlight | Rounded box slides behind the active word |
| One word | Single big word at a time, centred |
| Bounce | Words drop in with a spring |
| Typewriter | Characters appear in sequence |
| Keyword glow | Keywords (from Claude's `keywords`) get the accent colour + a size bump |
| Emoji | Emoji above keywords (Claude suggests them in the clip proposal) |

Controls: font (bundled Google Fonts: Montserrat, Inter, Bebas Neue, Poppins...), size, weight, uppercase,
fill/stroke/shadow, highlight colour, words per line, lines, vertical position, entry/exit animation, easing.

**Export**: ffmpeg handles decode/crop/scale/encode (VideoToolbox), and the caption engine renders a transparent overlay that
is piped into ffmpeg and composited. Phase 4 starts with a spike to confirm render speed (target: a 60 s clip in under 60 s on an M1 Pro).

### 4.6 Accounts (connect TikTok and YouTube)

This is OAuth to the platforms so we can post. It isn't app login.

- **YouTube**: Google OAuth (`youtube.upload` + `youtube.readonly` scopes) → YouTube Data API `videos.insert`.
- **TikTok**: Login Kit + **Content Posting API** (Direct Post, or "send to inbox as draft").
- Both of you connect your own channels. Accounts page: avatar, name, owner, connection status, reconnect, disconnect (with confirm).

**Platform constraints to plan around:**

| | Constraint | Effect on us |
|---|---|---|
| YouTube | Default API quota 10,000 units/day; one upload ≈ 1,600 units | ~6 uploads/day per Google Cloud project. We show remaining quota |
| YouTube | Uploads from unaudited API projects are **locked private** | Request the audit once private uploads work (end of Phase 5) |
| YouTube | OAuth apps left in "Testing" get refresh tokens that expire after 7 days | Set the consent screen to "In production" (fine unverified for 2 users; you click past one warning) |
| YouTube | `publishAt` schedules natively on YouTube | We upload early as private + publishAt, so **the Mac can be off** at publish time |
| TikTok | Unaudited apps can only post **SELF_ONLY**, and only to private accounts | Apply for the audit once posting works. Until then use **draft mode** (the video lands in your TikTok inbox and you tap Post) |
| TikTok | Audit approval for a 2-person tool is uncertain | Draft mode is a permanent fallback. A paid audited relay (e.g. Upload-Post) is the last resort |
| TikTok | No native scheduling in the API | We post at the exact time ourselves, so **the Mac must be on/awake** then |
| TikTok | Redirect URIs must be registered, likely HTTPS-only | A tunnel (cloudflared/ngrok) may be needed for the one-time OAuth connect |

### 4.7 Scheduling: "spread these 4 across Friday"

**Default audience: United States, `America/New_York` (ET).** The US is the only market that is top 2 on both TikTok
(roughly level with Indonesia, depending on how users are counted) and YouTube (second to India, where TikTok is banned).
Every time is shown in **ET and in your own timezone**, side by side. The audience timezone can be changed per account.

**Default window: 12:00–21:00 ET.** The posting-time studies (Sprout Social, Buffer, Hootsuite) disagree on days,
but agree on weekday afternoons and evenings. The hours they name most often for TikTok are about 15:00 and 20:00, and for
Shorts the evening, roughly 16:00–21:00. The window covers lunch, the afternoon peak and the evening peak.

**Default spread: edge to edge, on round times.**

| Clips | Times (ET) | Your time (e.g. CET, +6 h) |
|---|---|---|
| 1 | 15:00 | 21:00 |
| 2 | 12:00 · 21:00 | 18:00 · 03:00 |
| 3 | 12:00 · 16:30 · 21:00 | 18:00 · 22:30 · 03:00 |
| 4 | 12:00 · 15:00 · 18:00 · 21:00 | 18:00 · 21:00 · 00:00 · 03:00 |
| 5 | 12:00 · 14:15 · 16:30 · 18:45 · 21:00 | … |

Other modes: **Centred** (`start + (i + 0.5) × span / N`), or **Custom** times. There's optional ±10 min jitter
and an enforced minimum gap (default 90 min). Day hint: Tue–Thu is the strongest on most studies; no day is blocked.

> These are cross-account averages. From Phase 7, the app pulls each post's views after 48 h and suggests
> times that worked for **your** audience. That beats any published chart.

**Wizard (4 steps, each one reviewable):**

1. **Pick clips**: multi-select from any project's rendered clips.
2. **Pick where**: platform(s) and account(s). Same time on both, or offset by X minutes.
3. **Pick when**: date, window, spread mode. Prefilled with the defaults above.
   - If the date is today, the window starts at *now + 15 min*.
   - Warns about clashes with posts already scheduled that day, and about YouTube quota.
4. **Review & confirm**: a timeline of the day with each post card (thumbnail, time in ET + local, account, title,
   description, hashtags, privacy). Drag cards to reorder or retime, and edit any text inline.
   Then **"Confirm & schedule 4 posts"**.

Claude can fill this same wizard via `propose_posts`. You land on step 4 in the Inbox.

**After confirm:**
- YouTube posts upload immediately as private with `publishAt`.
- TikTok posts wait in the local queue. The card shows a badge, *"Needs this Mac awake at 03:00"*, and the app keeps
  the Mac awake while a post is pending (`caffeinate`). Late-night local times are flagged in the wizard.
- **A missed time** (Mac was asleep) is never posted silently late. The app asks: *Post now* / *Reschedule* / *Skip*.

**Calendar view**: week/month, with per-post status (scheduled → uploading → published / failed, with a link).

---

## 5. Data model (first cut)

```
projects        id, created_by, name, source_type(upload|youtube), source_url, status, duration_ms,
                width, height, fps, thumbnail_key, created_at, deleted_at
assets          id, project_id, kind(source|proxy|audio|thumbnail|render|overlay), storage_key, bytes, meta
transcripts     id, project_id, engine, model, language, words(json: text,start,end,speaker), edited_at
clips           id, project_id, start_ms, end_ms, title, hook, score, reason, keywords(json), emoji(json),
                origin(claude|manual|in_app_ai), status(proposed|approved|rejected), layout, crop_keyframes(json),
                caption_preset_id, caption_overrides(json), cuts(json), version
renders         id, clip_id, clip_version, status, asset_id, settings_hash, duration_ms
caption_presets id, name, builtin, config(json)
accounts        id, owner(name), platform(youtube|tiktok), external_id, display_name, avatar_url,
                tokens_enc, scopes, expires_at, audience_tz, status
posts           id, render_id, account_id, title, description, hashtags, privacy, scheduled_at (UTC),
                status(proposed|confirmed|uploading|scheduled|published|failed|missed), remote_id, url, error,
                schedule_batch_id, views_48h
schedule_batches id, date, timezone, window_start, window_end, mode, jitter_min, min_gap_min, confirmed_at
proposals       id, kind, payload(json), source(mcp|in_app_ai), status(pending|approved|rejected|executed),
                created_at, decided_at, decided_by
jobs            id, type, payload, status, progress, attempts, run_at, locked_by, error, project_id
settings        key, value(json)      -- defaults: timezone, window, spread mode, caption preset, mcp token hash
```

---

## 6. Screens

1. **Projects**: grid, a big "Add video" input, activity tray.
2. **Inbox**: pending proposals from Claude. A badge count sits in the sidebar.
3. **Project → Clips**: review grid (approve/reject), manual clip from a transcript selection.
4. **Clip editor**: preview + transcript + right panel (Captions · Layout · Hook · Export).
5. **Schedule wizard** + **Calendar**.
6. **Accounts**: connect YouTube / TikTok.
7. **Settings**: Connect Claude (MCP command + token), defaults (audience timezone, window, spread, caption preset),
   **System check** (ffmpeg / yt-dlp / whisper model present, versions, update buttons), storage usage.
8. **Trash**.

---

## 7. Phases (each ends with something usable)

| # | Phase | Done when |
|---|---|---|
| 0 ✅ | **Foundation**: workspace, Nuxt + Tailwind + Nuxt UI shell, Drizzle/SQLite, storage, job queue + worker, SSE progress, System check page | `pnpm dev` runs; a dummy job shows live progress in the tray |
| 1 ✅ | **Projects & ingest**: upload + YouTube link (preview → confirm → download), probe, proxy, thumbnail | Paste a link and get a playable project |
| 2 ✅ | **Transcription**: whisper.cpp, transcript view/edit (speaker labels moved to later) | Word-level transcript of a 1 h video |
| 3 ✅ | **MCP + Inbox**: MCP server, read tools, `propose_clips` + `propose_import`, Inbox, clip review, manual clips (guide ships as MCP server instructions instead of skills; local Host/Origin checks instead of a token) | "Claude, find clips in my latest project" → approve them in the app |
| 4 | **Editor & render**: text trimming, Fill/Fit layouts, caption engine + 8 presets, hook, export (spike first) | Downloadable captioned 9:16 MP4 that matches the preview |
| 4b | **Auto-reframe**: face tracking, smoothed crop path, scene-cut aware | Talking-head video stays framed without manual keys |
| 5 | **Accounts & publishing**: YouTube + TikTok OAuth, single post with a confirm screen, TikTok draft mode. **Then submit both audits** | A clip posted (private/draft) from the app |
| 6 | **Scheduler**: wizard with spread modes, ET/local display, calendar, dispatcher, missed-post handling, keep-awake, `propose_posts` | "4 clips across Friday" works end to end, from the UI and from Claude |
| 7 | **Learning & extras**: views after 48 h → personal best times, optional in-app AI (API key / Ollama), Split/Screen layouts | The scheduler suggests times from your own results |
| 8 | **Server-readiness** (only if needed): S3 storage driver, Postgres, Redis queue, app login, Playwright e2e | — |

Vitest covers the scheduler maths, caption timing/layout, clip boundary snapping, proposal execution and job retries from Phase 0.

---

## 8. Setup guide

### 8.1 This Mac (M1 Pro, 16 GB, Node 22, pnpm 10)

```bash
brew install ffmpeg yt-dlp whisper-cpp
```

The whisper model (~1.6 GB for large-v3-turbo) is fetched from the System check page.

### 8.2 Google Cloud (YouTube), about 15 minutes, needed by Phase 5

1. Create a project at console.cloud.google.com.
2. Enable **YouTube Data API v3**.
3. OAuth consent screen: External; add both of your Google accounts as test users; then **Publish app** ("In production"),
   so refresh tokens don't expire after 7 days. Google will show you an "unverified app" warning once when connecting. That's expected.
4. Credentials → OAuth client ID → *Web application*, redirect URI `http://127.0.0.1:3000/api/auth/youtube/callback`.
5. Put the client ID/secret in `.env`.
6. After Phase 5 works with private uploads: submit the **YouTube API Services audit** to unlock public uploads.

### 8.3 TikTok, needed by Phase 5

1. Create a developer account at developers.tiktok.com, then an app.
2. Add **Login Kit** and **Content Posting API** (enable Direct Post).
3. Register the redirect URI (we'll set up a tunnel URL if TikTok refuses localhost).
4. Use sandbox mode while building. Unaudited posting needs the TikTok account set to private.
5. After Phase 5 works: submit the audit (needs a short demo video of the app + a privacy policy page; we'll write both).

---

## 9. Decisions

| | Decision |
|---|---|
| Name | "Clip Studio" (working name, change any time) |
| Users | You + one friend, each on their own Mac with their own copy; no app login |
| AI | Claude via MCP is the brain; whisper.cpp local for transcription; optional in-app AI later |
| Developer apps | None yet. Create them per §8.2 / §8.3 before Phase 5 |
| Posting defaults | US audience, `America/New_York`, 12:00–21:00 ET, edge-to-edge round times, shown in ET + local |

Your friend runs their own copy on their own Mac (set up by you); nothing is shared between the two installs.
