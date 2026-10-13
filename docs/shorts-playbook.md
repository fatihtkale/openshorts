# Shorts playbook

What we know about making YouTube Shorts that get pushed, distilled (in our own words) from Deven Seenath's YouTube
Shorts Bootcamp (89 lessons, Oct 2025 – Mar 2026, via github.com/ingmarinho/yt-shorts-bootcamp, read 14 Oct 2026).
It's one experienced creator's view from running ~36 faceless channels (ranking, Roblox, clipping), not YouTube
documentation. YouTube changes often; where the course contradicted itself, the newest advice is kept and marked.

The clip rules that matter most live in code, so every evaluator applies them: `CLIP_RUBRIC`
(`packages/core/src/shared/evaluation.ts`) and `CLIP_PICKING_RULES` (`packages/core/src/shared/ai.ts`).

## What YouTube measures

- **Stayed to watch** (Studio → Engagement, "stayed to watch vs swiped away"): the share who don't swipe in the first
  seconds. Around 70–75% tends to stall; 80%+ is where Shorts take off. It starts low in the first hours while YouTube
  tests the video on mixed audiences and climbs as it finds the right one, so don't judge it before ~24 h.
- **Average view duration ÷ length** ("retention"). The target is above 100%: watched to the end and partly
  rewatched. A flat graph is good; every dip has a reason. Rewatches count more than likes or comments.
- **Satisfaction = feeling something.** Anything but boredom (tension, shock, a laugh, anger) reads as satisfied.
- **Comments** relative to views help push a video further (very roughly 1 per 1,000–1,500 views is healthy).
- Growth looks like a staircase: YouTube shows the video to a test group, and if it holds, to a bigger one. A video
  that flatlines failed a test, usually on stayed-to-watch or retention.
- **Audience** (Studio → Audience → watch behaviour): new vs casual vs regular viewers. Roughly half new viewers keeps a
  channel growing; casual viewers are the steady base that comes back.

## The clip itself

1. **Open inside the action.** An "anti-hook" (dropped mid-story, nothing explained) beats a context hook ("you won't
   believe…", "have you ever wondered…", "in this video…"). The point must be clear within 2 seconds. No intros,
   greetings or a streamer setting up ("chat, watch this").
2. **Lead-in of 1–3 s** before the key moment (our own rule, consistent with the course): show the approach, never open
   on the impact.
3. **Open on tension or shock**, not a calm or happy beat.
4. **Change the feeling.** Attention follows emotional change; retention dips where a beat repeats: the same joke
   twice, the same reaction, the same sound effect, a streamer saying "chat" over and over. In compilations, never put
   two clips with the same emotion next to each other.
5. **No calls to action** ("subscribe", "follow", "comment your favourite"). They cost viewers. Questions that invite
   an answer in the comments work only when they're part of a tense moment, and must never look like a giveaway.
6. **End on the payoff, abruptly.** No walking away, wind-down or outro; viewers see the progress bar and leave.
   Cutting a beat into the payoff makes people replay it. A dip in the last seconds is the most common fixable loss.
7. **Keep the frame steady** ("grid method"): the subject stays in the same area of the screen from shot to shot; no
   black bars or aspect-ratio changes mid-clip. Anything jarring wakes the viewer up and they swipe.
8. **Understandable without words or context** where possible: someone who doesn't know the game, server or streamer
   should still follow it (our mute test). Keep spoken/written language simple.
9. **Length.** The course pushed 32 s for months, then dropped that rule (Dec 2025): length matters less than finishing.
   24–32 s watched fully, or about a minute with ~44 s average view duration, both work. Our sweet spot (22–45 s) fits.
10. **On-screen text**: short (1–3 words on screen at a time for young audiences), uncluttered. Subtle commentary in
    your own words ("*floors it*", "he did not see that coming") also makes clips more clearly your own work.

## Posting

- **Upload every day.** Consistency builds the casual audience; missing days early on hurts most.
- **Spacing:** at most ~5 a day per channel, **2–3 hours apart** (Feb 2026; the older "45 minutes" advice was
  withdrawn). Our scheduler's default of 3 a day across 12:00–21:00 ET is well inside that.
- **Times:** the course posts for the US at 9:00–18:00 ET; ours is 12:00–21:00 ET. Let Insights decide from your own
  numbers once there are enough posts.
- **Titles:** short. Never the same title (or the same "don't click the sound"-style phrase) on every upload: YouTube
  treats repetition as spam.
- **Hashtags, tags, description:** the course leaves all three empty on Shorts so YouTube picks the audience itself
  instead of a narrow niche. Unrelated or "viral" trending hashtags are spam and have cost people their channels.
  Related hashtags (#NoPixel on NoPixel content) are allowed, but they narrow who it's tested on.
- **"Related video"** link: newer advice (2026) is to use it when the videos really are related; it doesn't hurt
  retention then and gets each viewer to watch more of the channel.
- **Not made for kids**, always (our uploads send that). Upload private first and let HD finish processing: scheduled
  posts already go up private hours ahead; "post now" goes straight to public.
- **Never delete** a Short that did badly; make it private if you must.

## Channel health

- Phone-verify the channel and turn on all feature-eligibility levels (Studio → Settings → Channel → Feature
  eligibility). Without them the course saw channels capped around 100k views.
- Don't set a country of residence you don't live in; leave channel keywords empty.
- Collaborations (Studio's collaborator feature) with a bigger channel in the same niche can kick-start a new one.
- When views suddenly crash on a healthy channel, unticking "Publish to subscriptions feed" on the next uploads was
  the course's fix.

## Clipping streams (our Twitch case)

- YouTube's reused-content policy targets clips of someone else's stream with nothing added. Make each clip clearly
  edited work: tight cuts, hook text and subtle commentary in your own words, captions, framing. Stream permission
  covers copyright, not this monetisation rule.
- Streamer habits are retention killers: talking to chat, reading donations, "follow the channel". Cut them.
- Content that gets channels struck: sexual content, real person-on-person injury, slurs, dead people or animals,
  children in danger. (Game violence isn't the issue; real-world footage is.)

## Not adopted

The course also recommends things we won't use: making up false stories or misinformation for comments, viral
hashtag tricks, verifying channels with other people's IDs, and multi-account set-ups meant to dodge bans. They break
YouTube's rules or are dishonest, and they put the channel at risk.
