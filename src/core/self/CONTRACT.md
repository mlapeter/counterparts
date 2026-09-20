# `self/` — CONTRACT

## 1. Purpose

The autobiographical self: identity documents, the first-person episode journal, and the
wake briefing that restores a continuous self — at session start for a live session, and,
composed read-only against a caller's own budget, for any background writer of memories
before it reads a transcript (owner ruling 2026-09-17). A composition bound for a model
call outside this machine stands confidential and protected rows out with
`BoundaryRequest.omit`; the published bundle and the identity rotation are written by
`boundary()` and by nothing else, so no such reader can move what a live session wakes to.

## 2. Brain analog

Autobiographical memory and the narrative self — episodic replay feeding a stable
self-schema, re-inhabited on waking rather than looked up. **Named deviations**
(constitution line 12): (a) humans never author their episodes — encoding is involuntary —
while here it is a ritual, which is the authorship thesis; (b) identity-band memories do
not decay here, where flashbulb memories do in humans; (c) **transcript-derived
self-reinforcement is deliberately not copied** — it is the rumination / illusory-truth
pathway, a documented bug of human cognition rather than architecture (owner ruling
2026-08-24).

## 3. Keeps

- **The briefing, grown up.** [v0] `top-60 by strength → Active Context / Core Knowledge /
  Recent Patterns / Fading Context, under 2000 characters` — the ancestor of v1's composed
  bundle and of this module's output. The section vocabulary is v0's and is worth re-reading
  before inventing another.
- **Identity is re-inhabited, not retrieved** — core memories are constitutive, not
  competed for in a ranker — and the briefing is framed as **context, not instruction**.
  [v1 §1] **Mechanized 2026-09-14: the identity lane ROTATES** (`identity.ts#byRotation`,
  least-recently-rendered first, never-rendered ahead of everything; strength, born-day and
  id only break ties), and `Self.boundary` stamps the ids it KEPT with the day
  (`self.rendered.<id>`). Before this the lane sorted by strength and the owner's live store
  rendered the same three of twenty identity beliefs every day (IMPROVEMENTS U6): eight tied
  at the clamp, oldest-born won, and the oldest-born were the ones written on migration day
  under a fresh clock.
- **Zero compute, zero model calls, zero network at wake**; the cost was paid by the
  previous boundary, so cold-start cost is constant in store size. [v1 §1 G1]
- **A composed byte budget, a declared trim order (v1: hints → craft → threads → horizon →
  identity last), and untrimmable riders.** A budget on a sub-lane is not a budget, and trim
  order *within* a lane is policy too: *truncation must never be iteration luck.* [v1 §1 G3,
  scar §2.3]
- **Header and tail sentinel each state the bundle's own true counts and bytes**, so a
  truncated injection is detectable from a truncation preview alone. [v1 §1 G2]
- **Delivery telemetry distinct from render telemetry** — v1 shipped 11 days of truncated
  wakes because only the render was instrumented. [v1 §1, scar §2.3]
- **Atomic publish**; an empty or short read is an error, never silently valid. [v1 §1 G5] —
  v1's empty concurrent read printed "your persistent memory is initializing" over a full
  store: identity amnesia disguised as a fresh install.
- **The wake never fails the session** — bootstrap line or nothing, then a clean exit.
  [v1 §1 G7]
- **Episodes are substance-paced, appended live, asked exactly once per blocked moment, the
  advance committed before the ask blocks, and collection never depends on the ritual.**
  [v1 §13 G1–G5] *Broken and restored 2026-09-04: v2 raised a second ask (authorship) on a
  second pacer beside this one, and the two fired on different Stops — about a dozen asks
  in a 13-turn evening. The pacing itself had drifted too: v1 re-asked on bytes AND turns,
  v2 on bytes OR turns with a byte threshold a third of v1's. One ask, one pacer, a
  conjunction — and a cap each SESSION spends on itself alone, per calendar day
  (`MAX_ASKS_PER_SESSION`). Measured 2026-09-17: a cap of four shared by every session a
  calendar day held refused 196 of 264 Stops, and the crash-fallback sweep wrote 888
  memories to the author's 193 — the author was not losing a fight, it was almost never
  invited. Amended 2026-09-18: spent over a session's whole life the same cap starved the
  long sessions instead, so the count starts over with the store's calendar date. The
  conjunction, not the count, is what holds the cadence.*
- **Episodes are context and source, in that order**, ingested once as ordinary self-kind
  memories with named handles. **"Episode" is not a memory kind.** [v1 §13 G6, Appendix A #11]
  *Reachable only from 2026-09-04: `ingestEpisode` had no caller outside its own tests, so
  the journal was a file that never became a memory. The door is `reconcileEpisodes` at
  `Counterpart.sessionEnd` — the boundary, not a script.*
- **Forgetting applies to what an episode PRODUCED, never to the episode.** The journal is
  the owner's own account and the source the memory was made from, so it is outside decay,
  dedup, consolidation and the floor prune (`sleep/CONTRACT.md` §5 G15,
  `sleep/types.ts#isJournal`); the memory minted from it fades like anything else.
  Constitution 6 (the owner owns the data, in prose readable in any editor) and 7 (memory
  changes like human memory — which is a claim about memories). *Measured 2026-09-04: all
  224 migrated episodes sit in the episodic band at zero on every dimension, so the phases
  that walk "every row" would have archived the whole journal at the floor — and an
  archived episode stops reconciling, so the memories it had not yet minted would never
  exist.*
- **The narration→span join is identity-safe** — spans with no session identity are skipped
  outright, because every anonymous session collapses to the same marker. [v1 §13 G7]
- **Ingestion is ordinary and the gates apply**: a first-person reflection is not exempt from
  never durably encoding a credential. [v1 §13 G8]
- **Add-first regrowth within a bounded window that CLOSES** — a deliberate deviation from
  human reconsolidation, which reopens on every retrieval. [v1 §13 G11–G12]
- **Named handles are aliases, not a second lookup path** — "the lighthouse conversation" enters
  through the ordinary rarity-weighted name channel. [v1 §9.2]
- **Lived salience is the only legitimate identity input.** [v1 §14.2, earned 2026-08-24]
- **Freeze, but keep counting** — the frozen arm runs the identical walk with identical
  guards, mutates nothing, and emits the same per-occasion event with a frozen marker.
  *The event IS the measurement; the movement is what is withheld.* [v1 earned-mechanism #8]
- **Recompression is render-only and archive-first, and the author's verbatim marks are
  durable state no model-facing path can set or clear** — "a choice that lives in prose is a
  choice the next autonomous run silently overrules." [v1 §7 G1–G4]
- **Every derived surface owes a scheduled reconciler** — "a script the owner runs
  occasionally" is not one — and every identity surface owes an answer to *which door
  reaches this?* (v1's craft file was reachable through neither of its two doors for weeks).
  [v1 §1 known gap]

## 4. Drops / simplifies

- **The v1 self-store tool is superseded by experiencer authorship.** Self-writing became
  the primary path — the doctrine that identity strength comes from lived salience is kept
  whole, and the end-of-session write *is* the front door it names. Not a silent drop: it
  resolves v1's own open watch, which recorded the deliberate channel at zero uses for a
  month while the doctrine named it as one of only three legitimate identity inputs.
  **If a doctrine names the only legitimate inputs, those inputs must be reachable by
  construction, not by a tool description nobody reads.**
- **The frozen-reinforcement machinery simplifies to a rule about authorship.** With the
  transcript sweep demoted to crash fallback, the channel the freeze blocks barely runs. The
  freeze stays — mechanized, on the fallback path, keeping its marker and its count — but as
  a guard on an exception rather than a permanent slice through the main loop. Softening is
  untouched on every kind: **the fallback remains a reporter on identity — it may soften, it
  never strengthens.**
- **The second-signature queue for permanent protection is dropped; legibility is kept.**
  **PROPOSED** — owner call at check-in; evidence and counter-argument in
  `schemas/CONTRACT.md` §4. The wake's untrimmable second-signature reminder goes with it;
  the self-store pointer goes with the tool.
- **The identity *index* as a separate derived surface — its own budget, warmth ordering,
  promotion path, and reconciler — is dropped.** **PROPOSED** — owner call at check-in. Why
  it looks safe: the index existed because canonical identity prose was too big to inject,
  and its promotion path had **zero production callers**, so the "warm shelf" could only
  cool. With identity elements as ordinary memories carrying strength, the briefing ranks by
  `strength` — v0's original design, needing no second structure and no reconciler to go
  stale. Recompression then applies to the briefing render, as v1's applied to the index.
- **The wake byte budget is not a core constant.** v1's 9,000 bytes was 90% of one host's
  injection cliff. **In v2 the ceiling is a host capability the adapter reports** (scar
  §2.18). The trim order, the sentinel, and the composed-budget discipline are core; the
  number is not.

## 5. Contract

**Inputs** — identity-kind memories and their strengths; the episode journal; **the written
self page, when the store holds one**; open `unresolved` memories; the prospective horizon;
the host's reported injection ceiling (or, for a read-only composition, the caller's own
byte cap); the lived day; the observer predicate; optionally a caller's `omit` predicate,
which stands rows out before any lane sees them.
**Outputs** — one pre-rendered briefing, published atomically; ingested episode memories;
**one revision of the self page, with its version and a durable row**; recompression
proposals and their archive; render and delivery telemetry.

**Guarantees** — **[M]** mechanized · **[A]** advisory:

1. **[M]** The briefing is pre-rendered by the previous boundary and is that boundary's last
   content write. Wake performs no ranking, no prose read, no model call, no network access.
   *A wake that is a DELIVERY also composes its preface (G3), which costs two meta reads and
   one `COUNT(*)` — the store's size is a delivery-time fact a bundle rendered yesterday
   cannot state. Nothing else, and a non-delivering read still pays one meta row.*
   **A second caller may compose without publishing** — `build()` ranks and renders and
   writes nothing, so a background reader pays a scan and changes no durable state: not the
   published bundle, not the identity lane's `self.rendered.<id>` rotation, not a counter.
   Pinned by a test that snapshots both across a fallback sweep.
2. **[M]** The budget governs the composed total, not each lane; the trim order is explicit
   and tested; the budget test runs **at production scale** — fixtures cannot reveal an
   overflow (scar §2.3). **The identity lane has a SHARE of that total** (`IDENTITY_SHARE`):
   while the other lanes have content, identity takes at most that fraction, by whole
   elements; when they cannot fill the remainder, identity takes the leftover back. It is
   not a lane budget — the total still governs — it is how the total is SPLIT when lanes
   compete, and it exists because identity trims LAST: measured 2026-09-03/04, a migrated
   store's ~1.1 KB identity elements filled all 9,000 bytes of every session's wake with 8
   identity statements and four empty lanes, while v1's wake the same day carried 20
   elements across four lanes. *Named limit: a share taken by whole elements is
   deterministic at a fixed budget — the host's case — but does not preserve the
   smaller-budget-is-a-subset property across budgets when one element is larger than the
   difference between them (NOTES §9, with the measurement). Truncating a belief to keep
   that property is the worse trade.* **An identity lane with no elements renders ONE line
   of furniture naming the identity core** (`briefing.ts#identityCoreLine`) when a core
   exists, and nothing when none does — the core is `type: "schema"` and no lane can reach
   it, so a store seeded by `install --name` composed a wake that named nobody (measured
   2026-09-04: 385 bytes, `elements=0`, four empty lanes and the owner's name nowhere in
   it). It is furniture and not an element: the counts and `elements` do not move, it
   carries no date because it has none, and it invents no content — it says who the memory
   is for and how the lane fills, and nothing else — and the name is FLATTENED, like every
   other string that reaches the bundle, because it is the only user-supplied one this
   module renders. **The empty lane guards BOTH seams**: the lookup, on the ranked lane,
   and the render, on the lane as it ARRIVED at `render` — never on the post-trim copy, so
   a store whose identity elements the budget trimmed away can never assert that it has
   none. A store with one identity element neither pays for the lookup nor renders the
   line (NOTES §11).
3. **[M]** Header and sentinel each state true counts and bytes. Because both state a number
   that composing them changes, composition iterates to a fixed point. A delivery-side event
   exists, not only a render-side one. **The delivered bundle carries a preface composed at
   WAKE and never stored** — which system, which lived day, today's date, how many live
   memories — because a bundle composed at a boundary is served unchanged to every session
   until the next one and cannot say any of that about the day it is read (2026-09-03: the
   memory system changed mid-day, the body went on speaking as the old one, and only the
   HTML comment named the new). Both stated byte counts are re-solved for the DELIVERED
   text, the renderer reserves the preface's room from the host's ceiling, and a damaged
   bundle is delivered exactly as found — never rewritten. **Every rendered element opens
   with the date it was learned** — `- YYYY-MM-DD · statement`, and
   `- YYYY-MM-DD (of YYYY-MM-DD) · statement` when the content date differs (neutral,
   because the horizon lane's dates are in the future). Leading, not trailing: the age is
   read before the claim, the element's own text still ends the line, and it costs 14 bytes
   at day precision against 21 for a trailing form — counted in the composed budget and in
   the identity share, on the same line the sentinel counts. The element text itself is
   never altered; the annotation lives outside it, so a belief still renders verbatim for
   contradiction detection, and the word "learned" is stated once in `FRAMING.context`
   rather than once per element. An undated row (a chased one reads `learned_on = ''`)
   renders with no prefix rather than an invented date. 2026-09-04: the wake carried no
   date of any kind, and a migrated element learned 2026-07-26 was read as a current fact
   and repeated to the owner as one. **A MIGRATED element's encode date is rendered as an
   upper bound** — `- by 2026-09-03 · statement`, +3 bytes — because the importer writes
   the IMPORT date wherever v1 carried none and nothing in the row tells those apart from
   the ones that kept v1's own: the first dated wake, run live 2026-09-05, read
   `2026-09-03 ·` on all eleven elements, a July incident and a mid-August finding among
   them. A wrong date is worse than no date; it is a confident claim in the one line the
   reader discounts everything else by. The exception is a migrated row carrying a CONTENT
   date, which renders plainly as any other does: `happened_on` is evidence about the thing
   itself and survived the import unaltered, and hedging real evidence would make `by` mean
   nothing. *Named cost: a migrated row that DID keep v1's own date and has no content date
   is hedged too — weaker, never wrong, and the alternative needs a per-row discriminator
   the import did not record.*
4. **[M]** Status does not accumulate on the self. A memory whose truth expires with a date
   is not an identity element, discriminated at encode time by one question: *would this
   still be a true memory worth holding after the date passes?* A standing counter reports
   self-schema bytes and trips before it can dominate a prompt again (earned-mechanism #5:
   ~72 KB, measured). The counter weighs what THIS system accumulates on the self:
   episodes (the journal, not the schema) and migrated rows are excluded and counted
   beside the fallback-minted quarantine — a migrated store read 3 MB tripped on day 0
   before anyone had written to it (2026-09-03).
5. **[M]** Identity strength comes from lived salience only. A fallback-authored
   confirmation against a self- or skill-kind element moves nothing — no `uses`, no strength,
   no band crossing, no lived day burned — and emits its frozen marker anyway, on the
   identical walk, so the frozen rate stays comparable to the live one.
6. **[M]** Softening is untouched on every kind. Freezing both directions would make the
   identity model unrevisable in both.
7. **[M]** Claims about other people are ordinary memory — learning about others from what
   they say is not self-narration.
8. **[M]** The freeze is decided on the *resolved* element, so a confirmation addressed to
   the wrong id still freezes.
9. **[M]** Recompression touches the render, never the canonical; the complete proposal set
   — accepted *and* rejected, with reasons and both texts — is archived **before** anything
   is applied; every proposal is re-judged at write time and rejected if empty, over cap, or
   not actually shorter; protected content is excluded independently of any mark.
10. **[M]** Episodes ingest idempotently by identity, against active *and* archived memories,
    so archival decisions are not resurrected by a stray touch.
11. **[M]** Observers receive the wake and are never asked for an episode. Accepted cost:
    instrument runs leave no episode (scar E7).
12. **[M]** Every derived surface has a scheduled reconciler, and a test asserts each runs at
    a boundary — not from a script the owner remembers to run. **The episode journal's is
    `reconcileEpisodes`, called by `Counterpart.sessionEnd` before the cycle**, so an
    ingested episode is inside the boundary that decays it and renders the briefing around
    it. It skips on a state read plus a hash, so an episode already ingested at its current
    text costs no scan. Found the day it was wired: `ingestEpisode` had no production
    caller at all, which is precisely the "which door reaches this?" failure §3 names.
   **The owner's out-of-band lever is `counterparts rebrief`** (`Counterpart.rebrief`,
   through the same `selfRenderer` the sleep step uses — there is no second renderer): it
   re-renders and republishes now, reserving the preface's room exactly as the boundary
   does, refusing under observer, and advancing no sleep marker and running no other sleep
   phase. It exists because a change to the lane rules merged mid-day cannot reach a single
   session's wake until the next boundary (measured 2026-09-04, the day the share shipped).
13. **[A]** The ask's wording is a preference and a probe. That an ask exists at
    every session-ending path, that there is exactly ONE of it per blocked moment, and that
    its orphanable tail is bounded and logged, is mechanized. Tool names and session ids are
    the ADAPTER's vocabulary and live there (constitution 5); this module's `askText` is the
    host-agnostic wording.
14. **[M]** Chapters are counted by what was WRITTEN, asks by what was asked, and the two
    are separate fields. The ask names `chapters + 1`. A second append with no new ask
    continues the chapter it is part of — appending in the moment is the doctrine's headline
    case (§13 G2), not an edge. Measured 2026-09-04: with the ask advancing the chapter
    count, the hook's number reached 7 in a session whose episode held nothing.

15. **[M]** **The self page is one row, written through one seam, and outside sleep's
    reach** (2026-09-18, owner rulings 8 and 9). `revisePage(body, { reason, by, session?,
    ifVersion? })` is the only door — the MCP tool, the owner's console and the nightly
    writer all arrive there — and it crosses the same gate battery the journal does, so a
    credential cannot land in the one piece of prose every session reads. **A redaction is
    reported**: accepted is not the same as unaltered, and both doors say so. Every
    accepted revision leaves a version (`store.revise` archives the prior one first) and a
    durable `self.page.revised` row; every refusal leaves a `self.page.refused` row and a
    named reason; an observer writes neither. The page is `type: "schema"`,
    `kind: "self"`, `meta.role = "page"`, born `protected` — which is what keeps the floor
    prune off it; dedup skips schema rows and (since 2026-09-18) so does the PROMOTION ARM
    of consolidate, so nothing promotes it into the identity band while beliefs go on
    consolidating unchanged, and `scanActive` cannot see it. **It is not a
    recall candidate and cannot be expanded by id**: the page is delivered whole at every
    wake, and a row that is already in the context is not a memory coming to mind. Its OLD
    VERSIONS take the ordinary retention, deliberately un-special-cased (owner ruling 1).
    Proved by a test that runs a full cycle and the prune over a store holding a page with
    two versions.
16. **[M]** **The page is what "Who I am" prints, first and as is**, under
    `PAGE_WAKE_BYTES` clamped to the caller's budget **less `PAGE_FLOOR_RESERVE_BYTES`, the
    furniture the wake wraps it in** — the page is furniture the trim loop cannot pop, so a
    page sized against the whole ceiling puts the composition over it with nothing left to
    trim. Over the cap it renders cut, at a paragraph then a line boundary and
    only where that boundary KEEPS most of the room — a page that offers neither is cut at
    a whole code point — with a marker naming the bytes shown,
    the bytes there are, and the command that reads it whole. Where the room is too small
    to be a page the wake says the page exists and does not fit, in one line; where there
    is no room for that either it says nothing. It replaces the rotating identity list by
    emptying the lane before the share, the trim order or the counts see it, so
    `counts.identity` and `elements=` state what the bundle actually carries and no
    `TrimEvent` is written for elements nothing dropped. It is furniture, like the day-0
    line: no `- ` bullet, no place in the counts. While NO page exists the wake renders
    exactly what it rendered before (`PAGE_EMPTY_SHOWS_LIST`, the owner's unmade choice),
    and the page's still-forming line is about the PAGE, never about identity.
17. **[M]** **`protected` on the page is the floor prune's word, and it no longer implies
    "stays on this machine."** A composition that filters (`omit`) is one that will leave
    the machine, and whether the page goes with it is `PAGE_ON_EGRESS` — a switch, default
    TRUE, which is the owner's decision of 2026-09-17 (spec §15 item 3: the background
    writer is woken as the self before it reads a transcript). Turned off, that composition
    gets no page and falls back to the identity list the predicate left standing. Nothing
    marks a page confidential: there is one page, and the switch is the decision.
18. **[M]** **ONE ROW FOR THE LIFE OF THE PAGE, and a page is unwritten rather than
    removed.** `clearPage` is an ordinary revision — the body it replaces becomes an
    ordinary version, attributed like any other — to a fixed cleared line, with
    `meta.cleared` set. The row stays live and keeps its whole version chain;
    `readSelfPage` returns null for it, so every reader sees a store with no page and the
    wake goes back to its empty-page behaviour exactly as if none had been written. The
    next write or `restorePage(seq)` revises the SAME row and drops the flag. Two
    properties follow and both are asserted: **there is never a second page row, live or
    archived**, however often it is cleared; and **nothing needs the event log** to find
    the page or its history (attribution still reads it, and says so when a row has been
    pruned). It is the OWNER's door: no MCP tool reaches it, because a session that could
    unwrite the page could erase the self between two turns. The owner's `remove` refuses
    the page row by name and points at it.
19. **[M]** **THE NIGHTLY PAGE WRITER RUNS ON THE CALENDAR, AT MOST ONCE, AND IS NOT A
    SECOND PACER** (`writer.ts`, S2, 2026-09-20 — true for now). A run is ABOUT one
    calendar date, always yesterday, and never chases a backlog. It is keyed to the
    calendar and not the lived day for I32's reason: the lived clock advances inside the
    cycle the detached worker runs, and a nightly mechanism keyed to a clock the night
    itself advances can miss every night and look on time. **The first durable row for a
    date is the CLAIM**, so two boundaries — or two machines' worth of hooks against one
    store — do not both set a night going; at most `PAGE_WRITER_ASKS_PER_DAY` sessions are
    offered one day. That is a COUNT and not a pacer: guarantee 3's scar is about the
    BLOCKED MOMENT at Stop, where one ask on one conjunction is the rule, and this ask
    rides beside the wake at SessionStart the way the first-launch scope question does,
    consulting no substance and spending none of `MAX_ASKS_PER_SESSION`.
    **A store with no yesterday writes nothing and leaves no row**, so a line about it
    cannot nag from the day a fresh install is made. **No revision is a first-class
    outcome**: host mode reports it (a windowless session handed one tool that did not use
    it has answered), session mode cannot tell it from "never got to it" and so does not
    claim to — it stores the claim, and the READING of a claim whose day has ended is
    `nothing-to-say`, marked `derived` wherever it is shown. `by: "writer"` is the DOOR's
    and is not claimable from a tool call: the evidence is a date the SessionStart hook
    wrote on the session's registry record, or one the launcher pinned onto a windowless
    child's environment, honoured only while that night's claim is open.
20. **[M]** **THE WRITER CAN WRITE THE PAGE AND ONE ROW, AND NOTHING ELSE.** The page goes
    through `revisePage` — the one seam, with its caps, its gate battery and its version
    chain — and `writer.ts` never touches it; what this module writes is the run's own
    durable row. No memory is created, none promoted, no strength moves. **No model call
    happens in core**: this module composes what the writer is handed and the ADAPTER makes
    the call, exactly as `counterpart.ts#sweepWake` composes and `interpret-client.ts`
    calls. A writer failure costs the writer: it never fails a wake, a boundary or a
    session, and with the writer off or never run the wake is byte-identical to a build
    without it (asserted).

**The briefing's tunables** — every one CAL (scar §2.8), all of them in `tunables.ts`, none
of them a budget. The composed budget is the caller's and lives nowhere in this module.

| Knob | Value | What it bounds |
| --- | --- | --- |
| `IDENTITY_MAX` | 24 | Identity elements *considered*. The budget and the share are the real bounds; this only stops a pathological store from composing a megabyte to throw it away. |
| `IDENTITY_SHARE` | 0.5 | The largest fraction of the composed budget identity may take **while other lanes have content to spend the rest on** (G2). By whole elements; released back to identity when nothing else can use the room. |
| `CRAFT_MAX` | 8 | Craft (skill-kind) elements considered. |
| `THREADS_MAX` | 12 | Open threads considered. Dark on a migrated store — INTERFACE-GAPS §8, and no cap can fix a missing source. |
| `HINTS_MAX` | 8 | Warm-shelf hints considered. |
| `HORIZON_MAX` | 6 | Arriving occasions considered (source borrowed — INTERFACE-GAPS §3). |
| `WARM_FLOOR` | 0.35 | Decayed strength a non-identity element must reach to be craft or a hint. Identity faces no floor. |
| `BUDGET_PRESSURE` | 0.9 | Fraction of the budget that fires the pressure event (scar §2.4). |
| `PAGE_WAKE_BYTES` | 6,144 | Bytes of the wake the self page may take, clamped to the caller's budget. Over it the page RENDERS cut, at a paragraph or line boundary, with a marker naming both numbers. |
| `PAGE_MAX_BYTES` | 16,384 | The hard WRITE limit. Past it a revision is refused rather than cut — what gets cut at write time is the only copy. |
| `PAGE_STALE_DAYS` | 14 | Calendar days after which the wake says the page has not been revised. Calendar, not lived: the lived clock has run 7 days across 15 calendar ones here. |
| `PAGE_EMPTY_SHOWS_LIST` | true | What "Who I am" shows while NO page has been written: `true` keeps the rotating list exactly as it is today, `false` prints the still-forming line instead. A page that exists replaces the list under both. The owner's choice, unmade; the default changes nothing until a page is written. |
| `PAGE_ON_EGRESS` | true | Whether a composition that FILTERS (`omit` — the crash fallback woken as the self) carries the page. The owner's decision of 2026-09-17; `false` gives that composition no page and the identity list the filter left standing. |
| `PAGE_WRITER_MEMORY_BYTES` | 8,192 | Bytes of the day just gone the nightly writer is handed. It reads one day, not a life, and what did not fit is counted on the run's row. |
| `PAGE_WRITER_MEMORY_MAX` | 40 | ...and a ceiling on the count, so a day of very short memories cannot become a hundred bullets. |
| `PAGE_WRITER_ASKS_PER_DAY` | 2 | How many SESSIONS may be offered one day's writing in session mode. A count, not a pacer (G19): the first session of a morning may be deep in something else, and two makes that survivable without asking all day. |
| `FIRST_ASK_TURNS` / `FIRST_ASK_BYTES` | 6 / 4,000 | The first ask needs both — or `SOLO_ASK_BYTES` alone. |
| `SOLO_ASK_BYTES` | 12,000 | Bytes alone, so a one-prompt agentic session still journals. |
| `REASK_TURNS` / `REASK_BYTES` | 8 / 8,000 | Further substance since the last ask, **both** required. |
| `MAX_ASKS_PER_SESSION` | 6 | Asks ONE SESSION may raise ON ONE CALENDAR DAY, its own count and nobody else's. A backstop on the total, not the cadence — the re-ask pair puts six asks at roughly 46 real turns. Per day, shared, it refused 196 of 264 Stops (2026-09-17); over a session's whole life it starved a session that spanned days (2026-09-18). |

`PAGE_FLOOR_RESERVE_BYTES` (512) and `PAGE_MIN_RENDER_BYTES` (240) are **not** tunable, for
the reason `PREFACE_RESERVE_BYTES` is not: the first is the room the wake's own furniture
takes around the page — measured at its widest (444) by a test, not guessed — and the
second is the smallest room worth rendering a page into rather than a fragment.

`PREFACE_RESERVE_BYTES` (128) is **not** tunable: it is the room the renderer subtracts from
the host's ceiling because delivery will add exactly that line, and one test bounds the
preface at its widest plausible day, date and store size against the same constant.

## 6. Scars honored

**E7** (observers receive but deposit nothing) · **E8** (episode pacing and the regrow
window run on lived days; the ask CAP ran on them too from 2026-09-04 and moved to the
CALENDAR DATE on 2026-09-11 — the lived-day clock advances only inside the sleep cycle a
detached worker runs, so a worker that could not start left the cap spent forever, I32 —
and on 2026-09-17 it moved onto the SESSION, where no clock spends it at all) · **the journal
is neither a memory nor a duplicate of one** (every sleep phase walked every row: dedup
merged the first real ingestion into its own journal at the boundary that minted it, and
prune would have archived all 224 migrated episodes at the floor — one predicate,
`sleep/types.ts#isJournal`, now holds the rule for all four) · **§2.3** (composed budget, sentinel, delivery telemetry, atomic
write) · **§2.4** (frozen markers are the measurement; a withheld move is a record, not a
silence) · **§2.7** (episode ingestion traverses the same gate as everything else — v1's
most heavily gated surface, 66% of all gate fires) · **§2.10** (strengthening without a live
softening path is a ratchet) · **§2.17** (every identity surface names the door that reaches
it) · **§2.18** (the injection ceiling is a host limit, never assumed) · **§2.19**
(permanence and write bar scale together).

## 7. Open questions

1. **Does the briefing keep v0's four sections or v1's lanes?** v0's are legible to a
   reader; v1's map to real data structures. The lineage argues for reconciling them once
   rather than accreting both.
2. **What is the honest reconciler cadence** when a session ends without a boundary?
   Pre-rendering means the briefing is always one session stale by design — a feature until
   the day's own episode is the thing the next session needs.
3. **Is the freeze still needed** once the transcript sweep is a crash fallback? It costs
   almost nothing to keep and keeps generating the evidence that could overturn it — which
   is also why its firing rate will now be near zero and hard to read.
