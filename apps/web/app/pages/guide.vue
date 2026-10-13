<script setup lang="ts">
import { CAPTION_PRESETS } from '@clipstudio/captions'
import { DEFAULT_SCHEDULE, DROP_OFF_MS, MUTE_TEST_LABELS, PILLARS, POST_STATUS_LABELS, SHORT_ARC_MS, SWEET_SPOT_MAX_MS, SWEET_SPOT_MIN_MS } from '@clipstudio/core/shared'

/**
 * The Guide: how Clip Studio works and how to use it, written for someone opening it for the first time
 * (including a friend setting it up on their own Mac). Numbers and names come from the app's own constants,
 * so the guide stays right when they change.
 */
const toc = [
  { id: 'overview', label: 'How it works', icon: 'i-lucide-route' },
  { id: 'checklist', label: 'Setup checklist', icon: 'i-lucide-list-checks' },
  { id: 'first-short', label: 'Your first Short', icon: 'i-lucide-graduation-cap' },
  { id: 'rules', label: 'AI proposes, you confirm', icon: 'i-lucide-shield-check' },
  { id: 'claude', label: 'Finding clips with AI', icon: 'i-lucide-sparkles' },
  { id: 'scores', label: 'How clips are scored', icon: 'i-lucide-gauge' },
  { id: 'editor', label: 'The editor', icon: 'i-lucide-wand-sparkles' },
  { id: 'twitch', label: 'Twitch VODs and clips', icon: 'i-simple-icons-twitch' },
  { id: 'posting', label: 'Posting to YouTube', icon: 'i-simple-icons-youtube' },
  { id: 'scheduling', label: 'Scheduling', icon: 'i-lucide-calendar-days' },
  { id: 'insights', label: 'Insights', icon: 'i-lucide-chart-column' },
  { id: 'data', label: 'Files and backups', icon: 'i-lucide-hard-drive' },
  { id: 'new-mac', label: 'Setting up a new Mac', icon: 'i-lucide-laptop' },
  { id: 'troubleshooting', label: 'Troubleshooting', icon: 'i-lucide-life-buoy' },
  { id: 'glossary', label: 'Words used in the app', icon: 'i-lucide-book-a' },
]

// Highlight the chapter being read: the last one whose heading has scrolled past the top quarter of the view.
// (Scroll events from the page's own scroll area don't bubble, so listen in the capture phase.)
const active = ref('overview')
let frame = 0
function spy() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const line = window.innerHeight * 0.25
    let current = toc[0]!.id
    for (const el of document.querySelectorAll<HTMLElement>('[data-guide-section]')) {
      if (el.getBoundingClientRect().top <= line) current = el.id
    }
    active.value = current
  })
}
onMounted(() => {
  document.addEventListener('scroll', spy, { capture: true, passive: true })
  // Opened with a #chapter link: go there once the page has laid out.
  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView())
  spy()
})
onBeforeUnmount(() => {
  document.removeEventListener('scroll', spy, { capture: true })
  cancelAnimationFrame(frame)
})

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // Keep the router's own history state, or it loses track of the current page.
  history.replaceState(history.state, '', `#${id}`)
}

const sec = (ms: number) => Math.round(ms / 1000)

const layouts = [
  { name: 'Fill', icon: 'i-lucide-crop', text: 'Crops the video to vertical. “Follow faces” keeps the speaker in frame and cuts with the shots; or drag the box yourself, even moving it over time.' },
  { name: 'Fit', icon: 'i-lucide-rectangle-horizontal', text: 'Shows the whole frame on a blurred copy of itself. Good for wide shots and screenshots.' },
  { name: 'Split', icon: 'i-lucide-rows-2', text: 'Two parts of the frame stacked: two people in a podcast, or a person and what they point at.' },
  { name: 'Screen', icon: 'i-lucide-monitor-smartphone', text: 'For screen recordings: the screen at full width, your face filling the rest. “Find my face” places the face box; “Face on top” swaps them.' },
]

const shortcuts = [
  { keys: ['Space'], where: 'Editor', what: 'Play / pause' },
  { keys: ['←', '→'], where: 'Editor', what: 'Back / forward 1 second' },
  { keys: ['S'], where: 'Editor', what: 'Show where YouTube’s buttons and title cover the video (safe zones)' },
  { keys: ['⌘', 'Z'], where: 'Editor', what: 'Undo' },
  { keys: ['⇧', '⌘', 'Z'], where: 'Editor', what: 'Redo' },
  { keys: ['J', 'K'], where: 'Inbox', what: 'Next / previous suggestion' },
  { keys: ['A'], where: 'Inbox', what: 'Approve the selected suggestion' },
  { keys: ['R'], where: 'Inbox', what: 'Reject the selected suggestion' },
]

const envKeys = [
  { key: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET', what: 'Lets the app upload to YouTube. From a Google Cloud OAuth client (see below).', need: 'For posting' },
  { key: 'ANTHROPIC_API_KEY', what: 'For in-app AI. You can also paste a key in Settings instead.', need: 'Optional' },
  { key: 'DATA_DIR', what: 'Where projects, videos and the database live. Default: the data folder inside Clip Studio.', need: 'Optional' },
  { key: 'PORT / HOST', what: 'The address the app runs on. Default: 127.0.0.1:3000 (this Mac only).', need: 'Optional' },
  { key: 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET', what: 'A Twitch developer app (dev.twitch.tv). Shows which moments of a VOD viewers clipped, and powers Smart import.', need: 'For Twitch VODs' },
  { key: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET', what: 'For TikTok, later.', need: 'Not yet' },
  { key: 'SECRET_KEY', what: 'Encrypts account sign-ins. Leave empty: the app makes data/secret.key itself.', need: 'Optional' },
]

const troubles = [
  {
    label: 'The sidebar says “Worker offline”, or nothing happens after I confirm something',
    content:
      'The worker is the part that downloads, transcribes and exports. It runs together with the app: in Terminal, go to the Clip Studio folder and run pnpm dev, and leave that window open. If it is running, stop it with Ctrl+C and start it again.',
  },
  {
    label: 'A YouTube link fails to import',
    content:
      'YouTube changes often. Update the downloader with “brew upgrade yt-dlp” and try again. Private, age-restricted and members-only videos can’t be downloaded; upload the file instead. An “ffmpeg exited with code 8” error on part-of-a-video downloads is retried automatically.',
  },
  {
    label: 'There is no transcript',
    content:
      'A speech model is needed: open System check and download one (Large v3 Turbo is the best choice). Then open the project and click Transcribe. It takes a few minutes per hour of video.',
  },
  {
    label: 'Words in the transcript are wrong',
    content:
      'Use “Fix words” in the transcript’s ⋯ menu; captions use your fixes. If the language was detected wrong, choose “Transcribe again…” and pick the language. A closing “Thanks for watching” after other speech is a known Whisper gap; add it with Fix words if you need it.',
  },
  {
    label: 'The crop doesn’t follow the speaker',
    content:
      'In the editor’s Layout tab, Fill mode, turn on “Follow faces”. If faces haven’t been found for this video yet, click “Find faces” and wait a moment. It follows visible faces; for anything else, drag the box (turn on “Move over time” to pan).',
  },
  {
    label: 'An export failed',
    content: 'Open the clip and export again from the Export tab. If it keeps failing, check that ffmpeg shows as installed on System check.',
  },
  {
    label: 'A YouTube post failed or the account says “Reconnect”',
    content:
      'Reconnect on the Accounts page (Google sign-ins can expire if the Google Cloud app is still in Testing mode; publishing the consent screen avoids that). “Quota” errors mean the daily upload allowance is used up; it resets at midnight US Pacific time. Then open the post in the Calendar and choose Post now.',
  },
  {
    label: 'My uploads are private even though I chose Public',
    content:
      'Google keeps videos uploaded through a new, unaudited API project private. That lifts once the Google Cloud project passes the YouTube API audit. Until then you can make a video public yourself in YouTube Studio.',
  },
  {
    label: 'Claude can’t see Clip Studio',
    content:
      'Keep pnpm dev running. In Claude Code, open it in the Clip Studio folder and approve “clipstudio” when asked; /mcp shows whether it is connected. After the app is updated, start a new Claude session so it sees new tools.',
  },
  {
    label: 'Starting fails with “compiled against a different Node.js version”',
    content:
      'The database module is built for one Node version, and your Terminal switched to another (the Clip Studio folder asks for Node 24). Run pnpm fix:sqlite once, then pnpm dev. pnpm checkup spots this too.',
  },
  {
    label: '“Port 3000 is in use” when starting',
    content: 'Clip Studio (or something else) is already running. Use the window it runs in, or set PORT=3001 in .env.',
  },
  {
    label: 'Something looks wrong after updating the app',
    content: 'Stop the app (Ctrl+C), run pnpm install, then pnpm checkup, then pnpm dev. Checkup lists anything missing and how to fix it.',
  },
]

const glossary = [
  { term: 'Project', text: 'One source video, with its transcript, clips and exports.' },
  { term: 'Transcript', text: 'Every spoken word with its exact time. Clips, captions and the AI all work from it.' },
  { term: 'Clip', text: 'A part of a project’s video (start to end) with its own look: captions, layout, hook and cuts.' },
  { term: 'Proposal', text: 'A suggestion from an AI: clips to make, a video to import or posts to schedule. It waits in the Inbox until you decide.' },
  { term: 'Hook', text: 'The short on-screen text in the first seconds that makes people stop scrolling.' },
  { term: 'Evaluation / score', text: 'An AI’s judgement of a clip on hook, pacing, payoff and standalone context, out of 10.' },
  { term: 'Export', text: 'The finished vertical MP4 of a clip, made on your Mac. Re-export after edits.' },
  { term: 'Post', text: 'An export sent (or scheduled) to a YouTube channel.' },
  { term: 'Job', text: 'A piece of background work: download, transcribe, export, post. Follow them in Activity (top right).' },
  { term: 'Worker', text: 'The background process that runs jobs. It starts with pnpm dev.' },
  { term: 'MCP', text: 'The connection Claude uses to read your projects and send proposals.' },
  { term: 'Safe zones', text: 'The areas YouTube covers with buttons and text. Keep captions and hooks out of them (press S in the editor).' },
]
</script>

<template>
  <PageShell title="Guide">
    <div class="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <!-- Table of contents -->
      <nav class="hidden lg:block" aria-label="Guide contents">
        <ul class="sticky top-0 space-y-0.5 text-sm">
          <li v-for="t in toc" :key="t.id">
            <a
              :href="`#${t.id}`"
              class="flex items-center gap-2 rounded-md px-2 py-1.5 transition"
              :class="active === t.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted hover:bg-elevated hover:text-default'"
              @click.prevent="jump(t.id)"
            >
              <UIcon :name="t.icon" class="size-4 shrink-0" />
              {{ t.label }}
            </a>
          </li>
        </ul>
      </nav>

      <article class="min-w-0 space-y-14 pb-24">
        <!-- Contents on small screens -->
        <div class="flex flex-wrap gap-1.5 lg:hidden">
          <UButton v-for="t in toc" :key="t.id" :label="t.label" :icon="t.icon" color="neutral" variant="outline" size="xs" @click="jump(t.id)" />
        </div>

        <!-- 1. Overview -->
        <GuideSection id="overview" title="How Clip Studio works" icon="i-lucide-route" lead="Long videos in, Shorts out. Here is the whole journey; click a step to read about it.">
          <GuideFlow />
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-lg border border-default p-4">
              <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-shield-check" class="size-4 text-primary" /> You confirm everything</p>
              <p class="mt-1 text-sm text-muted">
                AI suggests; nothing is downloaded, cut, exported, posted or deleted until you click to confirm it.
              </p>
            </div>
            <div class="rounded-lg border border-default p-4">
              <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-laptop" class="size-4 text-primary" /> It all runs on your Mac</p>
              <p class="mt-1 text-sm text-muted">
                Videos, transcripts and exports stay on this computer. Each person runs their own copy with their own projects and accounts.
              </p>
            </div>
          </div>
        </GuideSection>

        <!-- 2. Checklist -->
        <GuideSection id="checklist" title="Is everything set up?" icon="i-lucide-list-checks" lead="This checks your setup live. Fix anything marked, then you’re ready.">
          <GuideChecklist />
        </GuideSection>

        <!-- 3. Tutorial -->
        <GuideSection id="first-short" title="Your first Short, step by step" icon="i-lucide-graduation-cap" lead="About ten minutes, most of it waiting for the video to prepare.">
          <ol>
            <GuideStep :n="1" title="Add a video" to="/" to-label="Projects">
              <p>
                On <strong>Projects</strong>, paste one or more YouTube links, Twitch VODs (twitch.tv/videos/…) or Twitch clips and click
                <strong>Check link</strong>. You see the title, length and
                thumbnail first; pick the quality (1080p is recommended) and, if you only need a part, switch on <strong>Only part of the video</strong>
                and set From and To. Nothing downloads until you confirm.
              </p>
              <p>
                A <strong>Twitch clip</strong> is already a clip: it comes in whole, shows up in the project’s clip list right away, and
                can be scored automatically when it’s ready (a switch in the import dialog, with the cost shown). Long
                <strong>VODs</strong> download faster with “Only part of the video”.
              </p>
              <p>
                Or click <strong>Upload files</strong>, or drop video files anywhere on the window (MP4, MOV, M4V, MKV, WebM, AVI). Only use videos you
                own or may reuse.
              </p>
            </GuideStep>
            <GuideStep :n="2" title="Let it prepare">
              <p>
                The project goes from <em>Importing</em> to <em>Processing</em> to <em>Ready</em>. The app makes a preview copy, then transcribes the
                speech and looks for faces by itself. Follow it with <strong>Activity</strong> at the top right, where you can also stop a job.
                Transcribing takes a few minutes per hour of video.
              </p>
            </GuideStep>
            <GuideStep :n="3" title="Read the transcript">
              <p>
                It sits next to the video on the project page. Click a word to jump there; search; switch on <strong>Follow video</strong> to keep the
                spoken word in view. The ⋯ menu has <strong>Fix words</strong> and downloads (.srt subtitles, .txt).
              </p>
            </GuideStep>
            <GuideStep :n="4" title="Find clips" to="#claude" to-label="More about AI">
              <p>Three ways, mix them as you like:</p>
              <ul class="list-disc space-y-1 pl-5">
                <li><strong>Ask Claude</strong> (Claude Code or Claude Desktop, connected in Settings):</li>
              </ul>
              <GuideCopy kind="prompt" text="Find the best clips in my latest Clip Studio project" />
              <ul class="list-disc space-y-1 pl-5">
                <li><strong>Find clips with AI</strong> on the project, if in-app AI is on in Settings. It shows the cost before it runs.</li>
                <li><strong>By hand:</strong> drag across words in the transcript, click <strong>Make a clip</strong>, give it a title.</li>
              </ul>
            </GuideStep>
            <GuideStep :n="5" title="Review the suggestions" to="/inbox" to-label="Inbox">
              <p>
                AI suggestions land in the <strong>Inbox</strong>: a preview, the hook, why it works, and a score out of 10 with a bar per quality.
                Click <strong>Approve</strong>, <strong>Reject</strong>, or <strong>Approve trimmed</strong> when the AI suggests tighter edges.
                Keyboard: <UKbd value="J" /> <UKbd value="K" /> to move, <UKbd value="A" /> approve, <UKbd value="R" /> reject.
              </p>
            </GuideStep>
            <GuideStep :n="6" title="Make it look good" to="#editor" to-label="Editor guide">
              <p>
                On the project, click <strong>Edit</strong> on a clip. Pick a caption style, check the framing in <strong>Layout</strong>, add a
                <strong>Hook</strong>, tighten it in <strong>Trim</strong>. Everything saves by itself; <UKbd value="⌘" /> <UKbd value="Z" /> undoes.
              </p>
            </GuideStep>
            <GuideStep :n="7" title="Export">
              <p>
                In the editor’s <strong>Export</strong> tab, click <strong>Export video</strong> and confirm. You get a vertical 1080×1920 MP4, made on
                your Mac, usually in well under the clip’s length. Several clips? <strong>Export all</strong> on the project.
              </p>
            </GuideStep>
            <GuideStep :n="8" title="Post it, or schedule a batch" to="#posting" to-label="Posting guide">
              <p>
                Under the export, click <strong>Post</strong>: choose your channel, check the title, description and who can see it, and confirm. To
                spread several Shorts over a day, use <strong>Calendar → Schedule posts</strong>.
              </p>
            </GuideStep>
          </ol>
        </GuideSection>

        <!-- 4. Rules -->
        <GuideSection id="rules" title="AI proposes, you confirm" icon="i-lucide-shield-check" lead="The one rule behind every screen.">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-lg border border-default p-4">
              <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-eye" class="size-4 text-primary" /> AI can read</p>
              <p class="mt-1 text-sm text-muted">Projects, transcripts, video frames, clips and past suggestions.</p>
            </div>
            <div class="rounded-lg border border-default p-4">
              <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-inbox" class="size-4 text-primary" /> AI can suggest</p>
              <p class="mt-1 text-sm text-muted">Clips to make, videos to import and posts to schedule (all wait in the Inbox), and scores for clips (notes only).</p>
            </div>
            <div class="rounded-lg border border-default p-4">
              <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-ban" class="size-4 text-error" /> AI can never</p>
              <p class="mt-1 text-sm text-muted">Approve, cut, export, download, post, schedule or delete anything by itself.</p>
            </div>
          </div>
          <p class="text-sm text-muted">
            The same goes for you: downloads, exports, posts, schedules and deletions each have a confirm step, and deleted projects go to the
            Trash first.
          </p>
        </GuideSection>

        <!-- 5. Claude & AI -->
        <GuideSection id="claude" title="Finding clips with AI" icon="i-lucide-sparkles" lead="Claude does the thinking; the app does the cutting.">
          <h3 class="font-semibold">Claude (recommended)</h3>
          <p>
            Claude Code or Claude Desktop connects to the app and works with your own Claude plan. Setup is under
            <ULink to="/settings" class="text-primary">Settings → Connect Claude</ULink>. In Claude Code, opening it in the Clip Studio folder is
            enough: approve “clipstudio” when it asks. Keep the app running while Claude works.
          </p>
          <p class="text-sm text-muted">Things to ask:</p>
          <div class="space-y-2">
            <GuideCopy kind="prompt" text="Find the best clips in my latest Clip Studio project" />
            <GuideCopy kind="prompt" text="Find 5 clips about pricing in my project “Podcast 12”" />
            <GuideCopy kind="prompt" text="Evaluate the clips in my latest Clip Studio project and suggest tighter trims" />
            <GuideCopy kind="prompt" text="Import this YouTube video into Clip Studio: https://youtu.be/…" />
            <GuideCopy kind="prompt" text="Score the Twitch clips in Clip Studio and tell me which ones to post" />
            <GuideCopy kind="prompt" text="Schedule my exported clips for Friday" />
          </div>
          <p class="text-sm text-muted">
            In Claude Code you can also type <code class="rounded bg-elevated px-1">/mcp__clipstudio__find_clips</code> or
            <code class="rounded bg-elevated px-1">/mcp__clipstudio__evaluate_clips</code>. After the app is updated, start a new Claude session so it
            picks up new abilities.
          </p>
          <h3 class="pt-2 font-semibold">In-app AI (optional)</h3>
          <p>
            For when Claude isn’t at hand: turn it on in <ULink to="/settings" class="text-primary">Settings → In-app AI</ULink>. With a Claude API
            key it runs Claude from the app (billed to that key; each run shows its cost first). With Ollama it runs a free model on your Mac,
            privately, but picks less well. It adds <strong>Find clips with AI</strong> to projects and <strong>Evaluate</strong> to clips.
          </p>
        </GuideSection>

        <!-- 6. Scores -->
        <GuideSection id="scores" title="How clips are scored" icon="i-lucide-gauge" lead="Shorts live or die on two numbers: how many people swipe away in the first seconds, and how many watch to the end.">
          <p>Every AI judges clips the same way, on four qualities, each scored 1–10:</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div v-for="p in PILLARS" :key="p.key" class="rounded-lg border border-default p-4">
              <div class="flex items-baseline justify-between gap-2">
                <p class="font-medium">{{ p.label }}</p>
                <span class="text-sm text-muted tabular-nums">{{ Math.round(p.weight * 100) }}% of the score</span>
              </div>
              <div class="mt-2 h-1.5 rounded-full bg-primary/15">
                <div class="h-full rounded-full bg-primary" :style="{ width: `${p.weight * 100}%` }" />
              </div>
              <p class="mt-2 text-sm text-muted">{{ p.question }}</p>
            </div>
          </div>
          <ul class="list-disc space-y-2 pl-5 text-sm">
            <li>
              <strong>The total</strong> is the weighted average, worked out by the app (not the AI). 8 and up is <em>Strong</em>, 6 and up
              <em>Promising</em>, below 6 <em>Weak</em>.
            </li>
            <li>
              <strong>Mute test:</strong> many people watch without sound. Clips are marked “{{ MUTE_TEST_LABELS.pass }}”, “{{ MUTE_TEST_LABELS.weak }}”
              or “{{ MUTE_TEST_LABELS.fail }}”. Captions and a hook help a lot here.
            </li>
            <li>
              <strong>Length:</strong> {{ sec(SWEET_SPOT_MIN_MS) }}–{{ sec(SWEET_SPOT_MAX_MS) }} seconds is the sweet spot. Under {{ sec(SHORT_ARC_MS) }}
              seconds rarely tells a whole story; over {{ sec(DROP_OFF_MS) }} seconds loses viewers fast. The editor’s Score tab says where a clip
              stands.
            </li>
            <li>
              <strong>Drop them in:</strong> the best openings explain nothing (“he floors it toward the cops…”, not “you won’t believe
              this”). The point should be clear within 2 seconds; tension or shock opens better than a calm moment.
            </li>
            <li>
              <strong>Build-up first:</strong> clips start 1–3 seconds before the big moment (the approach before a jump, the setup
              before a punchline), so viewers see it coming instead of opening on the crash.
            </li>
            <li>
              <strong>Change the feeling:</strong> viewers leave where the same beat repeats (the same joke twice, a streamer saying “chat” again
              and again, “follow and subscribe”). Clips where the mood shifts (tension, shock, a laugh) hold people.
            </li>
            <li>
              <strong>End on the payoff:</strong> stop right there, even a beat early, with no walking away or wind-down. A Short people watch
              twice does better than a longer one they leave halfway.
            </li>
            <li>
              <strong>Start on the point:</strong> when an AI suggests a clip, the app cuts an opening greeting (“Hey guys, welcome back…”) and
              filler (“So, um, okay…”) by itself.
            </li>
            <li>
              <strong>Suggested trims</strong> are only suggestions: apply them with <strong>Approve trimmed</strong> in the Inbox or
              <strong>Apply trim</strong> in the editor (undo with <UKbd value="⌘" /> <UKbd value="Z" />). If you change a clip after it was scored,
              it says “Clip changed since”; evaluate it again for a fresh score.
            </li>
          </ul>
        </GuideSection>

        <!-- 7. Editor -->
        <GuideSection id="editor" title="The editor" icon="i-lucide-wand-sparkles" lead="The preview on the left is exactly what the export will look like.">
          <div class="space-y-3">
            <div class="rounded-lg border border-default p-4">
              <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-captions" class="size-4 text-primary" /> Captions</p>
              <p class="mt-1 text-sm text-muted">Animated captions from the transcript. Pick a style, then change font, size, colours and position:</p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <UBadge v-for="p in CAPTION_PRESETS" :key="p.id" :label="p.label" color="neutral" variant="outline" :title="p.description" />
              </div>
            </div>
            <div class="rounded-lg border border-default p-4">
              <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-crop" class="size-4 text-primary" /> Layout</p>
              <p class="mt-1 text-sm text-muted">How the wide video fits a vertical screen. Drag the coloured boxes on the frame to choose what’s shown.</p>
              <ul class="mt-2 grid gap-2 sm:grid-cols-2">
                <li v-for="l in layouts" :key="l.name" class="flex gap-2 text-sm">
                  <UIcon :name="l.icon" class="mt-0.5 size-4 shrink-0 text-muted" />
                  <span><strong>{{ l.name }}:</strong> <span class="text-muted">{{ l.text }}</span></span>
                </li>
              </ul>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-lg border border-default p-4">
                <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-megaphone" class="size-4 text-primary" /> Hook</p>
                <p class="mt-1 text-sm text-muted">On-screen text for the first seconds: short (under 6 words is best, 10 at most) and in your own words, reacting to what’s about to happen rather than repeating the speech. Choose the style, how long it shows and how high.</p>
              </div>
              <div class="rounded-lg border border-default p-4">
                <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-scissors" class="size-4 text-primary" /> Trim</p>
                <p class="mt-1 text-sm text-muted">Nudge the start and end, cut words by hand, shorten long pauses and remove “um” and “uh” in one switch.</p>
              </div>
              <div class="rounded-lg border border-default p-4">
                <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-gauge" class="size-4 text-primary" /> Score</p>
                <p class="mt-1 text-sm text-muted">The clip’s length against the sweet spot, its evaluation and suggested trim, and Evaluate.</p>
              </div>
              <div class="rounded-lg border border-default p-4">
                <p class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-film" class="size-4 text-primary" /> Export</p>
                <p class="mt-1 text-sm text-muted">Make the MP4, download it, and post it. It warns when you’ve edited since the last export.</p>
              </div>
            </div>
          </div>
          <h3 class="pt-2 font-semibold">Keyboard shortcuts</h3>
          <table class="w-full text-sm">
            <tbody>
              <tr v-for="s in shortcuts" :key="s.what" class="border-t border-default first:border-t-0">
                <td class="w-36 py-2">
                  <span class="flex gap-1"><UKbd v-for="k in s.keys" :key="k" :value="k" /></span>
                </td>
                <td class="w-20 py-2 text-muted">{{ s.where }}</td>
                <td class="py-2">{{ s.what }}</td>
              </tr>
            </tbody>
          </table>
        </GuideSection>

        <!-- Twitch -->
        <GuideSection id="twitch" title="Twitch VODs and clips" icon="i-simple-icons-twitch" lead="Streams are long; the app finds the moments worth clipping. Only use streams from creators who agreed.">
          <h3 class="font-semibold">Twitch clips</h3>
          <p>
            Paste clip links (twitch.tv/…/clip/… or clips.twitch.tv/…). Each one comes in whole and is already a clip in its project. Switch on
            <strong>Score … when ready</strong> in the import dialog and they get scored as soon as their transcript is done (the cost shows
            first), or ask Claude to score them.
          </p>
          <h3 class="pt-2 font-semibold">Twitch VODs</h3>
          <ul class="list-disc space-y-2 pl-5">
            <li>
              <strong>Highlights:</strong> once a VOD (or any video over 10 minutes) is ready, its project shows a heat strip and the top
              moments: what viewers clipped on Twitch, weighted by views, plus sudden loud moments (shouting, laughter, hype). Each moment starts
              3 seconds early. Click the strip to play from there, or <strong>Make clip</strong> on a moment.
            </li>
            <li>
              <strong>Shape the exact clip:</strong> click <strong>Adjust</strong> on a moment, or drag across the heat strip. A zoomed view
              opens with one bar per second and the viewer clips underneath: drag the start and end handles (or the middle to move it), or
              type times like 0:38 and 0:55. <strong>Play selection</strong> previews it; <strong>Make clip</strong> creates it.
            </li>
            <li>
              <strong>Cut out dead space:</strong> click <strong>Cut out a part</strong>. The view zooms in on the clip; drag over a pause
              or anything boring to leave it out (striped). Drag a cut's edge to adjust it, ▶ next to it to hear the jump, × to keep the
              part after all. Nothing is cut automatically. The length shown is what's left after cuts.
            </li>
            <li>
              <strong>Smart import:</strong> for a long VOD, click <strong>Find the hot moments</strong> in the import dialog and tick the
              ones you want. Only those parts download (each with a minute of build-up), as separate projects named after their most-viewed
              clip: minutes instead of hours.
            </li>
            <li>
              Viewer clips need a Twitch developer app: register one at dev.twitch.tv (any redirect, like http://localhost), then put its
              Client ID and secret in .env as TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET and restart. Without it, highlights use loudness only.
            </li>
            <li>Claude reads the same map: ask it to find clips in the hot spots of a VOD.</li>
          </ul>
        </GuideSection>

        <!-- 8. Posting -->
        <GuideSection id="posting" title="Posting to YouTube Shorts" icon="i-simple-icons-youtube" lead="Connect a channel once; after that every post is a few clicks and a confirm.">
          <ol class="list-decimal space-y-2 pl-5">
            <li>On <ULink to="/accounts" class="text-primary">Accounts</ULink>, click <strong>Connect YouTube</strong> and sign in with the Google account that owns the channel.</li>
            <li>Export a clip, then click <strong>Post</strong> under the export.</li>
            <li>Check the title (up to 100 characters), description, tags, who can see it (Private, Unlisted, Public) and “Made for kids” (YouTube asks it of every video), then confirm.</li>
          </ol>
          <p>
            The suggested title ends in #Shorts, but vertical videos up to 3 minutes become Shorts either way. A post’s status shows in the clip’s Export tab and on
            the <ULink to="/calendar" class="text-primary">Calendar</ULink>:
          </p>
          <div class="flex flex-wrap gap-1.5">
            <UBadge v-for="s in ['queued', 'uploading', 'scheduled', 'published', 'failed', 'cancelled'] as const" :key="s" :label="POST_STATUS_LABELS[s]" color="neutral" variant="subtle" />
          </div>
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="While the Google project is new"
            description="Google keeps uploads private until the Google Cloud project passes the YouTube API audit (a form in the Google Cloud console). Its default quota also allows only about 6 uploads a day; the same form can ask for more. Until then, test with private posts."
          />
          <h3 class="pt-2 font-semibold">Changing a post later</h3>
          <ul class="list-disc space-y-2 pl-5">
            <li>
              On the <ULink to="/calendar" class="text-primary">Calendar</ULink>, click a post, then <strong>Edit text</strong>: title,
              description, hashtags and tags. For a video already on YouTube, <strong>Save and update on YouTube</strong> changes it there
              too (YouTube asks for one extra permission: reconnect once on Accounts).
            </li>
            <li>
              <strong>Hashtags, tags and description</strong> start empty on YouTube posts, and hashtags are taken out of clip titles: left
              alone, YouTube tests a Short on a wide audience instead of only people who follow those tags. Never use unrelated or
              “viral” hashtags (YouTube treats them as spam). To add your own to every post anyway, set them under
              <ULink to="/settings" class="text-primary">Settings → Posting defaults → Default hashtags</ULink>.
            </li>
            <li>
              <strong>Related video</strong> (linking a Short to another video) can only be set in YouTube Studio; YouTube's API doesn't allow
              it. Note it when posting and use <strong>Open in YouTube Studio</strong> on the post: the video is already there, even when
              scheduled.
            </li>
          </ul>
          <p class="text-sm text-muted">TikTok support is built in for later; it stays hidden from posting until a TikTok account is connected.</p>
        </GuideSection>

        <!-- 9. Scheduling -->
        <GuideSection id="scheduling" title="Scheduling" icon="i-lucide-calendar-days" lead="“Post these nine, three a day, after what’s already planned”, spread evenly, checked by you before anything is set.">
          <ol class="list-decimal space-y-2 pl-5">
            <li><strong>Clips:</strong> pick exported clips, in the order they should go out.</li>
            <li><strong>Accounts:</strong> choose the channel(s).</li>
            <li>
              <strong>When:</strong> <em>After what’s already scheduled</em> (picked for you when posts are waiting) carries on from your last
              scheduled post: it fills that day if there’s room, at least the warning gap after it, then the next days. Or
              <em>Start on a day</em> and pick it. <strong>Posts per day</strong> (default {{ DEFAULT_SCHEDULE.perDay }}) spreads more clips over
              several days. Then the posting window: <em>Edge to edge</em> puts each day’s first post at the start and the last at the end;
              <em>Centred</em> puts each in the middle of an equal slice; <em>My own times</em> lets you set each one.
            </li>
            <li><strong>Review:</strong> every time is shown in your audience’s time zone and yours, with warnings if posts are too close; edit titles, then confirm.</li>
          </ol>
          <p>
            The default window is <strong>12:00–21:00 US Eastern</strong>: the US is the biggest Shorts audience, and afternoons and evenings are
            when it watches most. Change it under <ULink to="/settings" class="text-primary">Settings → Posting defaults</ULink>; once you have enough
            posts, <ULink to="/insights" class="text-primary">Insights</ULink> suggests a window from your own results.
          </p>
          <p>
            Scheduled YouTube posts are uploaded straight away and YouTube publishes them at the time, so your Mac can be off. On the Calendar,
            click a post to post it now, move it or cancel it. A video already waiting on YouTube can still move: <strong>Move on
            YouTube</strong> changes its publish time there too. Space posts 2–3 hours apart; the scheduler warns when they're closer.
          </p>
        </GuideSection>

        <!-- 10. Insights -->
        <GuideSection id="insights" title="Insights" icon="i-lucide-chart-column" lead="Learn which posting hours work for your channel, from your own numbers.">
          <ul class="list-disc space-y-2 pl-5">
            <li>The app reads each post’s views 2 days and 7 days after it goes live (the Mac needs to be on now and then).</li>
            <li>The chart shows, per hour of posting, how a post did compared with what’s usual for your channel: 100% is a normal post.</li>
            <li>
              After 10 posts with a 2-day count, it suggests a better posting window if one clearly beats yours. <strong>Use</strong> it with a
              confirm, and the scheduler starts from it.
            </li>
          </ul>
        </GuideSection>

        <!-- 11. Data -->
        <GuideSection id="data" title="Your files and backups" icon="i-lucide-hard-drive" lead="Everything lives in the data folder inside Clip Studio (or where DATA_DIR points).">
          <ul class="list-disc space-y-2 pl-5">
            <li><strong>Projects</strong> keep the original video, a preview copy, the audio for transcription, and every export.</li>
            <li>
              <strong>Trash:</strong> a deleted project goes to the <ULink to="/trash" class="text-primary">Trash</ULink> first, where you can restore
              it. <em>Delete forever</em> frees the disk space and asks first.
            </li>
            <li>
              <strong>Backups:</strong> while the app runs it saves a copy of the database every day (the last 14 are kept), with the key that
              unlocks your connected accounts. See and make them in <ULink to="/settings" class="text-primary">Settings → Backups</ULink>.
            </li>
          </ul>
          <p class="text-sm text-muted">From Terminal, in the Clip Studio folder:</p>
          <div class="space-y-2">
            <GuideCopy text="pnpm backup" />
            <GuideCopy text="pnpm backup --media --to /Volumes/YourDrive" />
            <GuideCopy text="pnpm restore" />
          </div>
          <p class="text-sm text-muted">
            The first makes a copy now; the second also copies all videos to an external drive; the third (with the app stopped) lists the copies
            and puts one back after asking, saving the current state first. Time Machine backs up the data folder too.
          </p>
        </GuideSection>

        <!-- 12. New Mac -->
        <GuideSection id="new-mac" title="Setting up a new Mac" icon="i-lucide-laptop" lead="For a friend running their own copy: about 20 minutes, mostly downloads.">
          <ol>
            <GuideStep :n="1" title="Install the basics">
              <p>Install <ULink to="https://brew.sh" target="_blank" class="text-primary">Homebrew</ULink> first (one command from its website), then in Terminal:</p>
              <GuideCopy text="brew install node pnpm ffmpeg yt-dlp whisper-cpp" />
            </GuideStep>
            <GuideStep :n="2" title="Get Clip Studio">
              <p>Get the Clip Studio folder (with git, or a copy of it), open Terminal in that folder, then:</p>
              <GuideCopy text="pnpm install" />
              <GuideCopy text="cp .env.example .env" />
            </GuideStep>
            <GuideStep :n="3" title="Check the setup">
              <GuideCopy text="pnpm checkup" />
              <p class="text-muted">It lists anything missing and how to fix it. It never changes anything.</p>
            </GuideStep>
            <GuideStep :n="4" title="Start it">
              <GuideCopy text="pnpm dev" />
              <p>
                Open <ULink to="http://127.0.0.1:3000" target="_blank" class="text-primary">http://127.0.0.1:3000</ULink>. Keep the Terminal window
                open while you use the app. Then go to <strong>System check</strong> and download a speech model (Large v3 Turbo).
              </p>
            </GuideStep>
            <GuideStep :n="5" title="Connect YouTube">
              <p>
                The app needs a Google Cloud OAuth client. Either use the one your friend already made (they add your Google account under
                <em>OAuth consent screen → Test users</em> and give you the ID and secret), or make your own: create a project, enable
                <em>YouTube Data API v3</em>, create an OAuth client of type <em>Web application</em> with this redirect address:
              </p>
              <GuideCopy text="http://127.0.0.1:3000/api/auth/youtube/callback" />
              <p>
                Put the ID and secret in <code class="rounded bg-elevated px-1">.env</code> as GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, restart the
                app, and click <strong>Connect YouTube</strong> on Accounts.
              </p>
            </GuideStep>
            <GuideStep :n="6" title="Connect Claude">
              <p>Open Claude Code in the Clip Studio folder and approve “clipstudio”. For other folders or Claude Desktop, follow Settings → Connect Claude.</p>
            </GuideStep>
          </ol>
          <h3 class="pt-2 font-semibold">What’s in .env</h3>
          <p class="text-sm text-muted">Settings live in the .env file in the Clip Studio folder. Never share it, or the data/secret.key file: they unlock your accounts.</p>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="e in envKeys" :key="e.key" class="border-t border-default first:border-t-0">
                  <td class="py-2 pr-3 align-top font-mono text-xs whitespace-nowrap">{{ e.key }}</td>
                  <td class="py-2 pr-3 align-top">{{ e.what }}</td>
                  <td class="py-2 align-top text-xs whitespace-nowrap text-muted">{{ e.need }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </GuideSection>

        <!-- 13. Troubleshooting -->
        <GuideSection id="troubleshooting" title="Troubleshooting" icon="i-lucide-life-buoy" lead="The usual suspects, and what to do. When in doubt: pnpm checkup.">
          <UAccordion :items="troubles" type="multiple" :ui="{ trigger: 'text-left', body: 'text-sm text-muted' }" />
        </GuideSection>

        <!-- 14. Glossary -->
        <GuideSection id="glossary" title="Words used in the app" icon="i-lucide-book-a">
          <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div v-for="g in glossary" :key="g.term">
              <dt class="font-medium">{{ g.term }}</dt>
              <dd class="text-sm text-muted">{{ g.text }}</dd>
            </div>
          </dl>
        </GuideSection>
      </article>
    </div>
  </PageShell>
</template>
