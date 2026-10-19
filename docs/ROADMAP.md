# Roadmap

*Updated 2026-10-19. A plan for now, not a rule. Change it when it stops fitting.*
*Earlier rounds: [roadmap-history.md](roadmap-history.md). What shipped when: [CHANGELOG](../CHANGELOG.md).*

**The aim:** memory that follows how human memory works, with a dashboard that shows whether
each mechanism is working. It should run in whatever AI host people use.

---

## Now

| | |
|---|---|
| **On npm** | 0.3.26 (Oct 18) |
| **On master, not released** | nothing yet |
| **Hosts** | Claude Code; the Desktop app's Code tab (verified live 10-02); Claude Desktop chat (0.3.9) |
| **Platforms** | Mac and Linux, under bun or Node 22.15+ (0.3.11); the plugin with neither, as one downloaded program (0.3.14). Not Windows. |

**In flight:**
- **The association walk**: diagnosed 2026-10-18; decisions next, after "what counts as use" (see Mechanisms).
- **First-prompt recall**: two bugs found by the benchmark, being diagnosed (see Retrieval).

---

## Next

1. **More hosts**: claude.ai, if it's doable (see Under discussion).
2. **Emotion, what's left**: watch feelings over weeks and re-feeling awake in real use (both built, 0.3.12). Coverage is no longer a thread: about 11% of memories carry a feeling, and that is expected.
3. **Mechanisms**, one at a time, each talked through before it's built: what counts as use, association, the notes module, dream throughput, then schemas with gist.
4. **Dashboard**: finish the walk (Health, Flow, mobile).
5. **Platforms**: Windows (WSL first).

---

## Mechanisms

*Where each stands, read 2026-10-19 on the owner's store (0.3.26, lived day 28) from `counterparts mechanisms`, doctor, CHECK-AFTER and the 10-18 association diagnosis.*

| | |
|---|---|
| ✅ **Working, watch only** | salience · reminders · contradictions · consolidation · forgetting |
| 🔧 **Working, needs a pass** | retrieval · dreaming · emotion (tuning) |
| 🟡 **Partly** | association · interference · episodic → semantic (gist) |
| ⬜ **Not built** | schemas |

**Working, watch only:**
- **Salience**: every memory scored at write (462 in the last 7 days).
- **Reminders**: 33 came back in the last 7 days (12 said plainly, 21 as footnotes).
- **Contradictions**: 111 settled in 7 days, 0 open. Later, if real use asks: find disagreements nobody wrote near each other (a sleep pass).
- **Consolidation**: returns slow fading; 3 memories became core this week. Returns this week: awake 105, reflection 47, dream 40, so the nightly passes supply nearly half.
- **Forgetting**: 834 memories below reach, 1 archived. Expected: 0.3.24 restarted the 14-lived-day wait, so archiving resumes around late October. Watch it then.

**Working, needs a pass:**
- **Retrieval**: works, quality uneven. Footnotes rated 0–3 at the session's end (288 so far): 47% noise, 35% on topic but not needed, 18% useful or changed what was said. A session's first prompt has no meaning channel (it is computed after each prompt for the next), and the word channel doesn't treat bake/bakes/baking as one word; both are being diagnosed (2026-10-19).
- **Dreaming**: works, but takes about 40–55 new memories a night by priority; the queue holds at 400–590 since about 10-10, the tail fading out on its own. On a busy day about 1 in 10 new memories is ever dreamed. Open: whether that's enough.
- **Emotion**: built (weight, slower fading, the seven-core wheel, valence-aware softening, later feelings, feelings over weeks, re-feeling awake). Its weight runs about ×11 slower fading at a strong feeling vs the ×2.8 the review designed; kept on purpose, rechecked 2026-11-01. Mood-matched recall stays off.

**Partly:**
- **Association**: about 9,500 links, and none has ever brought a memory to mind. Every link is far below either threshold, and nothing strengthens them: a link needs about four uses inside a month, and use is rarely credited (below). The hop channel can't change what's shown by construction. Decisions pending (2026-10-18 diagnosis).
- **Interference**: near-copies merge and a newer state replaces an older one; similar memories competing for recall isn't built.
- **Episodic → semantic**: dreams write about 8 gists a week; many episodes becoming one understanding happens only by chance.

**Not built:**
- **Schemas**: beliefs and entities that grow from what's lived.

**What connects them:** about 3% of shown memories are credited as used (opened by id, quoted, or named in `drewOn`), while 18% are rated useful. Use is what strengthens a memory and its links, so the gap starves association and leaves consolidation leaning on the nightly passes. "What counts as use" is the first mechanism conversation.

---

## Under discussion

- **claude.ai**: it reaches only remote servers, so it needs a tunnel or a hosted piece. Desktop chat shipped in 0.3.9, so this is the next host to decide on.
- **The site as public roadmap**: counterparts.ai should mirror this page. Not set up yet.
- **The nightly run's timing**: it runs at the day's first prompt now. A real night run would need a scheduler.
- **Dates written into memories' words**: why it happens, and whether to fix it at write time.

---

## Ideas (not scheduled)

- **"Her"-style onboarding**: a first conversation that seeds the first memories.
- **A journal entry per new model**, drawing on its system card.
- **A short check-in in the wake**: "how am I feeling, what do I need today".
- **Balance across projects**: context-weighted recall that never becomes silos.
- **Interactive `counterparts ask`**: arrow keys to move, Enter to expand.

---

## Parked

- **Flat dashboard sketch**: the owner's exploratory branch `dashboard/flat`.
- **Three-way identity study**: run it a second time before any write-up.
- **Confidential memories (frozen 2026-10-02)**: the confidentiality gate came over from v1, but no tool can mark a memory confidential and the live store holds none. It still runs through about 48 files. Leave it as it is, build nothing new around it, and don't block a review on it. The plan is to review it and remove it later, unless a real need for it turns up first.
- **A store outside the home directory**: `uninstall --dir` isn't supported.
- **Small open gaps**: sleep §9, handoff §4, mcp §2, mcp §9, cli §10–11, I11/I12. Details are in [roadmap-history.md](roadmap-history.md) under "Parked" and in each module's INTERFACE-GAPS.

---

## Recently done

- **10-18**: 0.3.26 on npm: "Still open" leads with what was touched in the last 14 lived days and counts the untouched, a stale handoff says its staleness in one sentence and only the newest shows whole when all are stale, the Yesterday line names folders (#517); "Today, elsewhere" dates a session started on an earlier day (#513); doctor's Fired line reads mood matching as disabled (#515); facts say a coarse date may be inside the time asked (#516); no store-format change, nothing to run after upgrading from 0.3.25
- **10-16**: 0.3.25 on npm: a chapter is stood for by a summary memory that fades, not a full copy; the `chapter` tool takes `summary`, the engine writes one when none is given (#504); the nightly reflection proposes closing stale open items and the reflect tool's `close` phase closes them on the owner's yes (#507); the wake lists long items as one line (#508) and is trimmed: one tag line, the date once, a shorter header, the page written to 4,600 bytes, craft out, Coming up = due today (#511); recall's rolling "last month"/"past N months" and weekdays in facts dates (#510); the sidebar says where you left off, its fox tries a picture first, its clickable rows are back in the full flavor, and the directory build stands down beside the npm install (#498, #499, #500, #501, #505, #509); no store-format change, nothing to run after upgrading from 0.3.24
- **10-14**: 0.3.24 on npm: a memory leaves only after 14 lived days under the floor, and a curve change starts that wait fresh, so nothing is archived for 14 lived days after upgrading; old claims the era lowers read at today's default all the way down (#494); Claude rates the memories it was shown 0–3 at the session_end ask, tracking only (#492); routine work left at the default salience by the tool text, "faded: weak, below reach", a reminder's whole moved chain closes together, an untitled revision keeps its title, `recall` takes `query` (#493); the plugin's uninstall leaves a working npm install's memory server and hooks alone (#487, #491); the sidebar counts feelings under Emotion (#488) and its footer fits the docked pane (#486); no store-format change, nothing to run after upgrading from 0.3.23
- **10-14**: 0.3.23 on npm, the build for Anthropic's plugin directory: the sidebar shows memory and acts on nothing (no buttons, no links, no network: it reads `~/.counterparts/sidebar.json`, written only while the plugin is installed), the brain gone and the fox kept (#480, #483); the directory build never reads `~/.claude.json` (no stand-down beside an npm install there, a known limit) and drops the dashboard's 3D brain (#481, #482); no store-format change, nothing to run after upgrading from 0.3.22
- **10-14**: 0.3.22 on npm: the plugin installs from its own generated repository, counterparts-ai/counterparts-plugin, which also carries the directory flavor (#475); the sidebar ready for Anthropic's directory: links in a terminal, buttons on the desktop, no search, the fox from image files, `counterparts dashboard` opens the one already running (#477, #478); MCP tool annotations (#474); session context offers rather than orders (#476); no store-format change, nothing to run after upgrading from 0.3.21
- **10-13**: 0.3.21 on npm: conversation text kept 3 days after write-up and never more than 14 days, never in a backup, `counterparts delete conversation-text|backups|activity-log` and "Delete data…" on the dashboard (#468); recall's carried words cleared past the same ceiling (#471); the plugin installs over HTTPS (#467); "installed twice" said once (#469); the fox polished and the sidebar's Desktop layout (#470, #472); no store-format change, nothing to run after upgrading from 0.3.20
- **10-12**: 0.3.20 on npm: plugin installs now remember from the second day, the wake gets a default 9,000-byte ceiling (#466); the first meeting is a short conversation that is never interrupted (no dream, write-up in the session, one question at a time, ends with what to do next), plain words in the wake and dashboard, a fresh install's doctor with no ambers, a one-line first-run notice and a store id for the sidebar, honest wording about recall by meaning (#450, #451, #452, #456, #458, #459); compaction starts unwatched, the wake never drops a section silently (#453, #454); the sidebar: onboarding, the split, the fox, no Claude Code memory switch (#447, #455, #460, #462); bundle README disclosures (#457, #461); the dead A/B file read removed (#463); no store-format change, nothing to run after upgrading from 0.3.19
- **10-12**: 0.3.19 on npm: reminders arrive: one due today stays under "Arriving:" all day, near ones first, never "told" to a turn nobody typed, a warning for a reminder-like memory with no date (#442, #445, #443); far fewer reads of Claude Code's own files (#444); the core can change, the night folds what belongs together, catch-up over written parts, cards born, one door for writes (#430, #432, #436, #429, #435, #427); the big-file split that fits the directory's 256 KiB limit (#439); no store-format change, nothing to run after upgrading from 0.3.18
- **10-11**: 0.3.18 on npm: the first meeting on every new install, started by the sidebar or `/counterparts:meet`, and dreaming on for new installs (#419, #416, #424); the plugin ready for Anthropic's directory: the bundle, no Bun auto-install, `/counterparts:dashboard`, install-aware doctor (#396, #394, #399); `uninstall` offers to delete, at a terminal, with a typed phrase, and `/counterparts:uninstall` (#414, #421, #425); older memories read at today's defaults (#395), merges and revisions keep what they were about (#398, #400, #403); the night writes up everything owed, `counterparts catch-up`, the reflection in its own session (#401, #407, #413, #426); what replaces what (#420, #408, #422); reminders (#393, #411); association (#423); last exchange, day order, chapter wording, the verbatim trial, context trims (#392, #405, #404, #409, #415); decisions fragments (#418); no store-format change
- **10-11**: 0.3.17 on npm: the sidebar mod v0.2, what memory is doing in 35 columns (#375); forgetting changes what comes to mind: each memory on its own curve, below reach, archived (never deleted) after 14 lived days under the floor, the dated hold, feeling counted once, old claims read at their defaults (#372, #377, #386); faded matches inline in facts recall (#379); `note` is `remember`, salience by attention, mood off (#369); `drewOn` (#385); about-marks (#383); the wake put together at session start, "Today, elsewhere" and "Since you started" (#376, #380, #387); a `remember` reaches the next wake the same day (#374); `counterparts rollback` (#384); scale fixes (#368, #373); follow-ups (#378, #382); changelog fragments (#381); store v12 to v13 and cache v5 to v6, nothing to run after upgrading from 0.3.16
- **10-10**: 0.3.16 on npm: the self page is kept up to 16 KB and the wake steps down a ladder of whole texts (page, short version, outline, headings, one line), its room 5,681 bytes (#363); dated items before the wake's furniture, and doctor's Wake line amber when one goes unlisted (#367); a paused folder says so at session start (#362); each hook output field bounded on its own, the claims file mends itself, late twins stand down, scope commands name the folder (#366); the plugin's first-run line again (#365); the sidebar lights every mechanism an event proves (#360); tools/term-loop (#364); no store-format change, nothing to run after upgrading from 0.3.15
- **10-10**: 0.3.15 on npm: the self page is never cut in the wake (#358); one delivery per event when the plugin and the npm install are both wired, the claims in a file of their own (#355, #359); `connect` and `install` rewrite Claude Desktop's entry and doctor reads it, so Desktop users run `counterparts connect` once (#354, #356); a yearless "by 1/5" in late December is the coming January (#356); the sidebar mod in the plugin (#342); CI runs the whole suite (#357); RELEASING.md (#356); no store-format change
- **10-09**: 0.3.14 on npm: the plugin runs with no Bun or Node, as one prebuilt program per platform (#351); a project's `.env` and `bunfig.toml` stay out of the hooks and the server, so npm users run `counterparts connect` once (#349); the wake keeps "Still open" beside a long page and says when a reminder was due (#350); facts names corrected versions, reads amounts and "by 12/20" right, meaning says when a name has no card (#345, #347, #348, #352); dashboard and doctor follow-ups (#343, #346, #347); no store-format change
- **10-09**: 0.3.13 on npm: dates that repeat, and corrections held when they look unrelated (#339–#341); facts reads "last Saturday" and "before 7/22", meaning answers about the person asked about, the dashboard's Ask in both modes (#333, #334, #338); doctor without false alarms on Fired and Wake, and the night checks its own transcript (#325, #330, #337); the Claude Code plugin (#328); no store-format change
- **10-08**: 0.3.12 on npm: recall's two modes, facts and meaning, and what a memory records (#321–#323, store v12); with 10-02's work below
- **10-02**: on master: one measured ceiling for tool results (#315); feelings round 3 (#317); follow-ups after 0.3.11 (#318); the Desktop app's Code tab verified live
- **10-01**: 0.3.11 on npm: the morning catch-up and "Yesterday" line; "Work here" vs Nearby; Node 22.15+ and Linux; the Code tab files under its own session; recall by feeling, round 2; dashboard Health fixes (#306)
- **10-01**: 0.3.10 on npm: the feelings wheel v2 (seven cores, store v11); handoffs per session; the "Last here" line; recall by time (a question about time leads with this directory's last session)
- **09-30**: Claude Desktop chat; recall by feeling (0.3.9); handoffs per session; the feelings wheel redesigned with the owner; event log; coverage ("answered" isn't "written up"); the wake keeps up; dashboard feedback; Desktop's Code tab verified
- **09-29**: contradictions (changed / corrected / open, with undo); headless nightly run (0.3.7)
- **09-28**: nightly run (0.3.6); association links; fitting more into a night; looser guards
- **09-27**: reflection and the self page; traits (0.3.5)
- **09-26**: dreaming; reminders; feelings recorded (0.3.3, 0.3.4)
- **09-25**: dashboard, first version; time handling and store v7 (0.3.1, 0.3.2)
- **09-24**: keyless by default; quieter Stop ask (0.3.0)
