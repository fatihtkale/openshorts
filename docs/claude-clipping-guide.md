# Clip Studio: how Claude finds, cuts and schedules clips

A working guide for any Claude (Claude Desktop or Claude Code) helping with Clip Studio. It's the workflow and the
judgement that worked on our NoPixel / GTA RP Shorts channel, written down so the result doesn't depend on who's asking.

The app already sends every connected Claude the basics (tools, the 4-pillar rubric, the lead-in rule) in its MCP
server instructions. This file adds **how** to work through a batch, **what to reject**, and **what we learned** from
real posts. Where they overlap, they agree.

**How to use it**
- **Claude Desktop:** create a Project (e.g. "Clip Studio"), add this file to the project knowledge, and work in that
  project. Clip Studio must be connected as an MCP server (see Setup).
- **Claude Code:** open Claude Code in the repo folder; CLAUDE.md points here.
- Background on why these rules exist: [shorts-playbook.md](shorts-playbook.md).

---

## 1. Setup (once per Mac)

1. Clip Studio running (`pnpm dev`, see README). The app is at http://127.0.0.1:3000.
2. Connect Claude: in the app, **Settings → Connect Claude** shows the Claude Desktop config and the Claude Code
   command. The server is called `clipstudio`; it serves `http://127.0.0.1:3000/mcp`. Restart Claude Desktop after
   adding it. If tools fail with "connection refused", the app isn't running.
3. Accounts: connect the YouTube channel on **Accounts**. For Twitch "what viewers clipped", add a Twitch app's
   `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` to `.env` (never paste secrets into chat).
4. The in-app **Guide** (sidebar) is the user manual for everything below.

## 2. Ground rules

- **You propose, the user decides.** MCP tools only read, propose (clips, imports, schedules) or save evaluation
  notes. Nothing is cut, exported, posted or deleted until the user confirms in the app. Say "it's waiting in the
  Inbox", never "I created it".
- Never delete anything (projects, clips, YouTube videos). Weak scheduled videos get *moved* (parked), not deleted;
  deleting on YouTube is the user's job in YouTube Studio.
- Uploading/scheduling new videos, moving or editing videos already on YouTube: only with the user's clear yes for
  that action.
- Only clip creators who agreed to it (our sources: smaller NoPixel streamers who gave permission).
- Don't put secrets in chat or files. Don't use misleading titles, fake stories or spam tactics.

## 3. What we learned on this channel (the evidence)

- Our **first post** got **18.8% "stayed to watch"** (people who didn't swipe away). Healthy Shorts sit around 80%.
  Its opening: two characters mid-conversation, no hook text, 40 s of talk. Strangers had no reason to stay.
- We scored the first 18 hand-cut clips: **none above 6.5**, seven below 4.5. The same four problems every time:
  1. **Needs context:** RP dialogue that only makes sense if you know the characters or saw part 1.
  2. **Dark:** night footage is unreadable on a phone, especially in the first frames.
  3. **Too long:** 48–65 s with long cruising/talking stretches.
  4. **Ends on aftermath:** walking away, the downed screen, chatter after the payoff.
- From 41 imported segments, the strict approach below found **4** clips (scores ~7–8): a wall ride that ends in a
  burning flip, a ramp jump that flips the cops, a "you look like Dr. Doofenshmirtz" roast with a face close-up, and a
  crash nobody mentions in the transcript. The user approved all four. **Few strong clips beat many weak ones.**

## 4. The quality bar

Propose a clip only if **all** of these hold:

- **Readable on mute.** The picture tells the story (a crash, jump, fight, theft, a visual punchline). Dialogue-only
  clips need a joke strangers get without context (universal references: Doofenshmirtz, SpongeBob, LeBron).
- **Lit.** The opening frames are clearly visible on a phone. Daylight or well-lit interiors.
- **Opens on action or a question.** No setup, greetings, "chat, watch this", phone-call screens, menus.
- **Lead-in 1–3 s (max 5)** before the key moment, so viewers see it coming; never open *on* the impact.
- **Ends on the payoff.** Cut right after the punchline or landing; a beat early is better than lingering.
- **20–35 s** usually. Shorter (9–15 s) is fine when it has an arc and loops (rewatches count most). Over 45 s needs
  a very good reason.
- **Rubric score ≈ 7+** (hook 40 %, pacing 30 %, payoff 20 %, standalone 10 %). Score honestly; the app computes the
  total from your pillar scores.

**Auto-reject** (mention them as skipped, with the reason):
night/dark footage · meetings, business talk, phone calls, menus, inventory screens, crafting UIs · a funny line over a
static shot (one person standing on a call) · the key moment happens off screen · a promo/ad segment inside the
footage · Whisper "music loops" (the same line repeated for a minute = a song, not speech) · a moment that's already
scheduled (check list_clips; the same incident filmed from another streamer's view is a duplicate, keep the better POV).

## 5. Workflow for a batch of imported videos

### Step 0: what's there
- `list_projects`: only `ready` projects with a `ready` transcript. Note which already have clips.
- `list_clips` per project you'll work on, so you don't re-propose what exists.

### Step 1: read every transcript
- `get_transcript` for each project, all pages (`nextFromSec`). For long Twitch VODs call `get_highlights` first and
  read around the top hot spots.
- Triage into: **action candidates** (crash, jump, chase, flipped, "oh my god", "we're dead", "he's dead", cops,
  explosion), **comedy candidates** (a joke a stranger gets), and **talk** (meetings, logistics, lore).
- Note **long silent stretches** (big gaps between words). Silence often hides the best visual moments.

### Step 2: check the footage of every candidate
- `get_frames` takes **at most 8 times per call**; use `width: 256` for scanning, `320` for detail.
- First pass: 6–8 frames across the candidate's span to see what's on screen and whether it's lit.
- Detail pass: frames every **0.3–1 s** around the moment to find the exact impact/landing (e.g. 48.9, 49.2, 49.5,
  49.8, 50.3 s). Edges are chosen from this, not from the transcript alone.

### Step 3: sweep the "talk-only" segments anyway
Don't trust the transcript to tell you nothing happens. Our best find (a crash with the driver launched through the
windshield) had no words about it at all. For every segment you'd otherwise skip:
- **Claude Desktop (MCP only):** frames every ~10 s through the whole video, 8 per call (e.g. 0–70 s, 80–150 s).
- **Claude Code (has a shell):** one contact sheet per video, a frame every 5 s:
  `ffmpeg -v error -y -i data/storage/projects/<id>/proxy.mp4 -vf "fps=1/5,scale=200:-1,tile=6x7" -frames:v 1 sheet.jpg`
  (read left→right, top→bottom: tile *n* = *n*×5 s). Homebrew ffmpeg has no `drawtext`, so no timestamps on tiles.
- Anything interesting → detail pass (Step 2).

### Step 4: exact timing
- Word-level times: `search_transcript` for the key phrase, or `get_transcript` around it. In Claude Code,
  `GET /api/projects/<id>/transcript` returns every word with ms timings.
- **Whisper quirks:** word timings can stretch across silence (a "word" lasting 10 s); speech can be stamped a few
  seconds early; over music it may repeat one line for a minute or invent "Thank you." Always confirm the moment with
  frames.
- Edges snap to word boundaries; edges in silence stay where you put them. The app also trims an opening greeting or
  filler ("so", "um") from proposals by itself.

### Step 5: write the clip
- **Title** (≤ 60 chars, honest, no hashtags): say what happens and name who it is when it helps a stranger click:
  "T-Unit's wall ride ends in flames… somehow they're alive", "He jumps the ramp and leaves the cops upside down
  (NoPixel)". Word each title differently; YouTube treats repeated title patterns as spam.
- **Hook text** (on screen at the start, ideally under 6 words, your own words, opens a loop, never repeats the
  speech): "Wall ride… what could go wrong", "Cops on his tail… watch this", "Wait for the close-up 😭",
  "On his way to help…".
- **Keywords**: 1–4 spoken words to highlight in captions ("alive", "dead", "Doofenshmirtz"). **Emojis**: optional,
  one per key spoken word (`dead` → 💀).
- **Reason**: one or two sentences on why it works.

### Step 6: evaluate and propose
- Give every clip a real evaluation (pillar scores + notes: why the first 3 s work, where viewers might leave, the
  payoff, the mute test). Drop anything under ~7 unless the user asked for more.
- `propose_clips` **once per project**, best first, with the evaluation and a short `note`.

### Step 7: report back
- A table of what's in the Inbox: title, length, score, one line on why.
- What you skipped and why (dark, talk-only, off-screen, duplicate…), plus near-misses (~5–6) the user can ask for.
- Duplicates of already-scheduled moments, and which version is better.
- Be honest about coverage ("read all 41 transcripts, checked footage of 21, swept the other 20").

## 6. Judging clips that already exist

For clips the user cut by hand (or scheduled already): `list_clips` → `get_transcript` a little before/after each clip →
`get_frames` at start (+0.3, +2, +4.5 s), middle, end (−2.5, −0.5 s) → `evaluate_clip` per clip with exact
`suggestedStartSec`/`suggestedEndSec` only when you're sure (check the transcript for where the payoff line ends).
Then a ranked summary: which to keep, which to trim, which to pull. It's a note; it never changes the clip.

## 7. Posting and scheduling (what we settled on)

- **YouTube Shorts only** for now (TikTok later).
- **Metadata:** title without hashtags; **no tags, no hashtags, empty description** (lets YouTube find the audience
  instead of testing only on people who follow #NoPixel); category **Entertainment**; not made for kids. These are the
  app's defaults. Names in the title (NoPixel, xQc, Marty…) do the targeting instead.
- **Times (US audience, New York time):** weekdays around **12:15 (lunch), 15:10 (after school), 18:05 (after work),
  20:40 (prime time, also 17:40 on the West Coast)**; weekends earlier: **~10:45, 13:30, 16:20, 19:10**. Vary the
  minutes each day; avoid identical round hours.
- **Spacing:** 2–3 h between posts, 3–4 a day (max 5). The scheduler continues **after what's already scheduled** and
  warns under 2 h.
- **The Calendar shows New York time by default** with the user's own time in grey ("+1" = next day for them).
  A US evening post shows after midnight in Europe; that's correct, not a bug.
- **Before scheduling:** the clip's export must match its latest edit (Clips page shows "Edited since export";
  re-export first).
- **Already-uploaded scheduled videos** can be moved with **Move on YouTube** (Calendar). Weak ones get parked a few
  weeks out instead of deleted; the user deletes in Studio if they want.
- **Measuring:** "Check views now" on Insights reads current views any time; the best-hours suggestion compares posts
  at the same age (2 days), so wait ~48 h before judging a post. In YouTube Studio, watch **stayed to watch**
  (aim 70–80 %+, it starts low in the first hours) and **average view duration vs length** (aim ≥ 100 %).

## 8. Examples from our batches

**Proposed and approved**

| Clip | Edges | Why it worked |
|---|---|---|
| Wall ride ends in flames | 11.4–34 s (23 s) | Car riding a slanted concrete wall in second one; flips off the edge ~10 s in, lands burning upside down; "we're alive" is the punchline. Daylight, mute-proof. |
| Ramp jump, cops flipped | 27.3–56.3 s (29 s) | Opens on "I'm jumping right now" mid-chase; jump lands ~5 s in beside a flipped car; swap into a supercar; ends on "Call me 500 IQ… not smart". |
| Doofenshmirtz roast | 37.6–74.5 s (37 s) | Opens on a question everyone knows; payoff is a phone-camera close-up of his face; hook text "Wait for the close-up 😭" holds viewers through the talk. |
| Rushing to save his friend… | 45.5–54.5 s (9 s) | "He's dead, I think he's dead" while racing to help, then a T-bone and he's launched through the windshield. Found only by sweeping frames; short enough to loop. |

**Rejected (and why)**
- Tank jump at night: unreadable, and a duplicate of a scheduled clip from another POV.
- Scooter "terrorism": funny audio, but the footage is dark and from a downed player's view.
- "Speedy iced her": the kill happens off screen; on screen a truck just drives away.
- LeBron/Bronny line, ATM "pump pump pump": great lines over one person standing still.
- "Lucky escape": a black frame mid-moment and a promo video after 46 s.
- Meetings, phone calls, crafting/inventory screens, fishing: nothing for a stranger.

## 9. Pitfalls we hit

- **Twitch links:** both `twitch.tv/videos/<id>` and `twitch.tv/<channel>/video/<id>` work. For long VODs use
  **Smart import** (only the moments viewers clipped download) instead of the whole stream.
- **Face analysis** doesn't run on import anymore (most game footage has no faces); "Find faces" in the editor's
  Layout tab when needed.
- **Duplicates across POVs:** NoPixel crews stream the same incident from several characters; compare and keep the
  view that shows the moment.
- **Dark ≠ fixable:** the exporter can't brighten footage; pick a lit moment or skip.
- **Streamer habits kill retention:** talking to chat, reading donations, "follow the channel", repeating a line.

## 10. Prompts to paste

- *"Go through every ready Clip Studio project without clips. Read all transcripts, check the footage of every
  candidate and sweep the talk-only ones for visual moments, then propose only clips that meet the quality bar in the
  clipping guide. Report what you proposed, what you skipped and why."*
- *"Evaluate the clips scheduled this week (list_clips, transcript and frames for each), save evaluate_clip notes and
  tell me which to keep, trim or pull."*
- *"Suggest which of these imported VODs' moments are worth a Smart import"* (with the VOD link).
