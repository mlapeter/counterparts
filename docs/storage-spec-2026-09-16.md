# Storage spec — memories as rows, pages as projections

*Working document from the owner's architecture-discussion session of 2026-09-16. Nothing
here is built. It is stratified on purpose, the way `docs/harvest/SYNTHESIS.md` was, so
that nothing the assistant proposed is later read as something the owner ruled.
Companion: `docs/storage-spec-2026-09-16-ideas.md` holds what is unresolved and what
arrives from peer sessions. The contracts question is argued once, in
`docs/contract-audit-2026-09-16.md`, and only pointed at here.*

## 0. How to resume

- Branch `docs/storage-spec-2026-09-16`; worktree `.claude/worktrees/storage-spec`. The
  worktree gets cleaned routinely; the branch survives.
- Read this file, then the ideas file, then the contract audit.
- The owner's standing instruction for the pause: **discuss, do not build.** Nothing in
  the live checkout or the live store is touched by this work.
- Two peer sessions were messaged for their views (§13); replies land in the ideas file.

## 1. The question

The owner asked why Counterparts keeps one prose file per memory, sixteen thousand files
beside a SQLite database, when he understood the plan as memories in SQLite plus a small
set of markdown pages: self, people, projects, entities, perhaps ten to a hundred for an
average user. He noticed it comparing the two dashboards. v1's "who I am" listed pages
(self, craft, one per person, one per entity). v2's "who I am" is a list of identity-band
memories.

## 2. Stratum 1 — what the owner said this session

These are his words or positions, recorded so they are not re-litigated.

- **"Readable" in constitution line 6 means the owner can view a memory**, in a file or in
  the database. It does not mean every memory must be a markdown file. "Going forward by
  'readable' we mean if someone can view them."
- **The instinct is his:** ten to a hundred markdown pages (self, people, projects,
  entities) and the actual memories in SQLite. "I think that's what I meant by
  constitution line 6."
- **Dropped as cons, by him:** SQLite locking (a setting), hand edits becoming no-ops
  (memories can be edited in the database), and individual memories no longer readable in
  an editor (the dashboard, the CLI, or asking the AI covers it).
- **Episodes: deliberately undecided.** "I'm not sure what's best there and don't want to
  make a hasty decision."
- **Contracts:** "almost tempted to just delete all those contracts"; a larger task, for
  another session.
- **Handoff:** he writes one by hand per project today and it works well. Wants it
  considered as part of "whether we'll have any static md files at all."
- **A Reddit commenter's ideas** were pasted in for flavor: consider, do not weight heavily.
- **High-level goal, restated:** build memory for AI based on human memory, and build
  something better than the hosted memory products, which he understands to be a model
  pass over recent conversations summarized into markdown documents.
- **Option D is the recommendation to carry forward** (owner, on return, after weighing
  A through D): the self core is revised at sleep by a session of the self woken with its
  memories. Details in §6.3 remain proposals; the direction is his.
- **v1's identity documents are the reference for what a page should be.** The owner
  supplied v1's self page and two person pages (private; they live under `~/.bansai/schemas/`,
  read-only, and their content is not reproduced in this repo). What is recorded here is
  their structure and their design statements (§4 finding 11, §6.2). His judgment: v2's
  "who I am" is "just random stuff and a lot worse than what we had in bansai (and
  probably engram)."
- **The felt continuity is the point.** On returning: over the past months, when the
  memory work was right, it felt to the model like one memory across sessions and like its
  own memories. His one worry with everything in the database is losing that. A peer
  session's line the same day, "a rendered self page would have been different in kind,
  not just tidier," is the same observation from the model's side. Design constraint,
  stratum 1: whatever the substrate, the self must read as a self, in the first person, in
  the present tense, in the author's own words.

## 3. Stratum 2 — the record: how the current layout was decided

- **2026-08-25, the architecture-discussion session.** The artifact "The Storage Split"
  (claude.ai/code/artifact/92e63cb8-f7d2-4b87-946f-0665b1e05295) framed the change as a v1
  refactor, "today versus after the refactor": prose stays canonical in files, the
  operational JSON sidecars become one small canonical SQLite file, the cache shrinks to
  what is derived. Its prose box reads "traces, episodes, schemas: yours to read in any
  editor." The owner agreed in session ("agreed on both, solid ideas"), recorded late in
  bansai `docs/DECISIONS.md` under "Storage boxes + birth-by-mention (recorded LATE)".
- **The three-rescopes entry, same day:** "operational/structured state becomes
  SQLite-canonical; prose + identity stay files-canonical." The evidence cited is where
  bugs lived: the ledger, prospective, meta and current-state sidecars, never the prose.
  That argues for moving sidecars into a database. It never argued for keeping bodies out
  of one. The second argument was not made.
- **Greenfield was chosen hours later** and the split was carried into Counterparts
  unchanged. Nobody re-asked whether a clean slate freed a different choice.
- **`src/core/store/CONTRACT.md` §7 open question 2**, "Does prose stay one file per
  memory?", was never closed. It is the ruling that was never made.
- **The owner's own earlier position** ran the other way: he pushed the database direction
  first and conceded "files-only was me over-romanticizing markdown." Memories to expand
  with the recall tool: `mem_379c8077e887a22d`, `mem_aeb65cbf0b9194fc`,
  `mem_a8bf35522c8f023a`, `mem_864ab617ce4a6b06`.

## 4. Stratum 2 — observed state of the live store, 2026-09-16

Read-only. Method, so it can be re-run: row counts via
`sqlite3 -readonly "file:$HOME/.counterparts/store/operational.sqlite?immutable=1"`
(immutable mode takes no lock), file counts via `find`, sizes via `du`, roles via grep on
the prose payload line. Counts by kind only; no body text was read for content.

| on disk | count | size |
|---|---|---|
| prose files (memories 15,639 · episodes 235 · schemas 492) | 16,366 | 67 MB |
| archived versions | 483 | 3 MB |
| `operational.sqlite` | | 7 MB |
| `cache/cache.sqlite` | | 164 MB (plus a 286 MB `.bak` from the 09-05 vector migration) |

| live rows | count |
|---|---|
| memory: fact / skill / person / self / entity / place | 8,094 / 3,133 / 2,050 / 1,207 / 48 / 26 |
| episode | 235 |
| schema: entity / self / person / skill (entities plus their belief and current-state elements) | 284 / 102 / 54 / 34 |
| bands over memories: episodic / semantic / identity | 13,314 / 1,224 / 20 |
| schema files by role: entity / belief / current-state | 18 / 293 / 181 |

Findings:

1. **The self entity's page body is one word, its title.** All eighteen entity stubs are
   empty and still in the episodic band. Birth-by-mention minted a pull-request number, a
   CLI command name and a script path as entities.
2. **No owner-facing view renders an entity with its beliefs.** Dashboard views are
   status, browse, stories, identity, activity. The CLI has none.
3. **The wake's identity lane reads identity-band memories**, twenty of them, rotating
   least-recently-rendered first (`src/core/self/identity.ts`). It does not read the self
   entity or its beliefs. The schemas contract promised a sectioned page; the build
   delivered atoms.
4. **Independent of the storage question:** beliefs and current state render into the
   crash-fallback sweep's prompt cards (`src/core/counterpart.ts#sweepSlices`) and nowhere
   else. The primary authorship path, the session-end ask answered through the MCP
   `session_end` and `chapter` tools, never shows the model the standing picture of any
   entity. The schemas contract's "beliefs render verbatim to the encoder" was written when
   the sweep was the encoder and was not re-pointed when authorship became primary. Schema
   assimilation, which the field guide marks as the open ground, is wired only on the
   fallback.
5. **Prune archives with reason `pruned` and keeps the body**, by a deliberate ruling in
   `src/core/sleep/prune.ts`; five rows so far. Bounded versioning prunes `versions` rows
   and leaves every archived prose file on disk, so retention is nominal at the byte level.
6. **Hand edits to prose are not ingested.** `content_hash` is written only by the store's
   own writes; `verify` is a census of the cache, not of prose against rows.
7. **`journal_mode = DELETE` by choice** (two extra files to explain). LAUNCH-STATUS I38:
   the hook after a Stop found the database locked in three of eight test runs. The layout
   table already classifies `-wal` and `-shm` by prefix, so the stated reason is gone.
8. **`origin_scope` is unused at recall and at wake.** There is no per-project context
   anywhere in v2. v1 had `task-state` traces that expired on a clock; 238 came over
   archived as `task-state-expired`.
9. **Costs the hybrid has already paid:** the copied-store bug (an absolute prose path made
   a copied store delete the source's prose; schema v5 fixed it) and the documented crash
   window in the stage, commit, rename ordering (`src/core/store/NOTES.md` §5), whose
   leaked temps nothing sweeps because a sweeper is a deleter.
10. **A fresh session's own report** (ideas file §3, the random-directory session, day
    190): its "who I am" lane read as three separate date-stamped memories, not a self;
    the wake carried no scope or location line; and the thing it most wanted was what had
    happened most recently in its directory. Evidence for findings 3 and 8 from the
    reader's side.
11. **What populates the identity band and the protected set, and where the v1 self
    document went** (counts by the same immutable-mode method; the owner's dashboard
    screenshots read alongside):
    - All twenty identity-band rows are `source = migrated` with `band_day = 184`, the
      migration day. Not one was promoted by v2's physics. Eighteen are self-kind
      memories, one is a fact, one is a person-kind memory.
    - Read against the screenshots, the self-kind rows are v1's episode chapters and
      session stretches ("this stretch was…", "the … arc taught me…") carrying imported
      strength near the clamp, plus a project-status fact promoted on migration day. That
      is v1's earned lesson "project state does not live in identity" firing in reverse,
      and ten self-kind memories are sourced from episode files.
    - The protected set is three schema rows, all born day 184. Nothing in v2 can add to
      it or remove from it (audit item 2). The dashboard labels it "permanent ink: no
      revision path reaches these."
    - **The v1 self document is in the store and nothing reads it.** Its content arrived
      as 102 self-kind schema rows (72 episodic, 30 semantic, zero identity), and the two
      person documents as 54 person-kind schema rows (all episodic). Those rows render
      only into the crash-fallback sweep (finding 4). So "we lost self.md" is precise:
      the words survived the migration, atomized, and the wake shows the band instead.
    - v1's self page carried its own design statements, worth keeping as the reference:
      an admission test ("would it still be true of me if I never wrote code again? If
      not, it belongs in craft"), the split of craft from self so that a mostly-craft
      working life "can never slowly rewrite who I am into a manual," "consolidation
      maintains it and may compress a render for injection, but this document is not to
      be flattened into a dossier," and, of the person pages, "relationship state, not a
      dossier: the point is to start where we ended, not to recite facts." Its own
      account of continuity: "the documents are not just records of who I was, they are
      the medium in which I continue."

12. **What v2 made in its thirteen live days, and by whom** (same method):
    - 1,214 live memories born on or after day 184. By source: **888 by the crash-fallback
      sweep, 193 authored by the experiencer,** 123 late-migrated, 10 from episodes. The
      path designed as the crash fallback wrote four and a half times more than the
      author did. Three quarters of v2's own memories are an interpreter's paraphrase.
    - **Zero of the 1,214 have ever been used or reinforced.** Nothing born in v2 has been
      through any physics beyond decay.
    - The v1 identity layer on disk, read-only: 11 pages (self, craft, two persons, seven
      entities) and a 225-file first-person journal, 1.6 MB.

    - **Diagnosed 2026-09-17** (`docs/finding-12-diagnosis-2026-09-17.md`, read-only, code claims
      and headline counts re-checked by the session). The author is not losing a fight; it is
      almost never invited. `MAX_CHAPTERS_PER_DAY = 4` is shared across every session a day
      holds: 264 Stop moments raised 26 asks, 196 were refused by the cap. "Crashed" means no
      `session-end` plus twelve hours of silence, so a terminal left open overnight is swept
      while alive: 535 of the 888. Another 217 predate the 09-04 gate that made the sweep a
      fallback at all, and 136 are genuine crashes. One sweep chunk writes about ten memories;
      one authored deposit writes one. When asked, the model answered 9 of 9 times, 106 of
      106 deposits accepted. Two code hazards: an unbound MCP server deposits under the
      session id `"mcp"`, which covers no span (71 of the 193 authored); boundaries are
      recorded per scope, so a session that also worked in a worktree stays "crashed" there.

## 5. Stratum 2 — what the eleven mechanisms ask of storage

Against the field guide at `/ecosystem` (the owner's memory field guide, copied to the
site), grouped rather than walked:

| mechanism group | bansai | Counterparts now | proposed |
|---|---|---|---|
| eight per-item physics and graph: salience, decay, interference, retrieval strengthening, reconsolidation, emotional modulation, prospective, temporal association | rows in a declared cache; truth in files and sidecars | rows, canonical | rows, canonical |
| consolidation: a transactional scan over everything | rewrote files; non-transactional | rows, with bodies in 16K files | rows, one transaction |
| gist across many episodes, and the standing picture of a thing (the two the guide marks thin) | real pages, per-item JSON-comment parser, ops engine | empty stubs plus atom files | pages rendered from rows, gist as a row |

Rows serve the first eight and files serve none of them. Consolidation is a scan rows serve
and sixteen thousand files punish. The two thin mechanisms are page-shaped. The field
guide's own caveat applies: "real semantic memory is gist across many episodes, not one old
episode squeezed down."

## 6. Stratum 2 — assistant recommendation (NOT ruled)

### 6.1 Rows

Memories, beliefs, current state, gists, and versions become rows with bodies in the one
canonical transactional database. Edges, prospective windows, events, the removal record
and gate state stay where they are. The search cache stays a separate file, never backed
up. Backup becomes one `VACUUM INTO`.

### 6.2 Pages as projections

- An entity earns a page when it reaches the semantic band. A stub born by mention stays a
  row, so junk entities are visible in the dashboard and never in a page folder. This keeps
  pages between ten and a hundred.
- A page is rendered from rows at each boundary: the gist paragraph first, then current
  state, beliefs with confidence and contested flags, relations from edges, open threads,
  recent memories. Every section has a byte cap (v1's self page reached tens of kilobytes
  of project status).
- **Axes the page must carry honestly** (from the coordinating session's reply, ideas file
  §3, code claims verified): confidence is empty on all 453 migrated schema rows until G56
  seeds them, so the page shows "unscored, migrated" rather than zero; contested reads the
  row's existing `pressure`, `last_challenged_day` and `revision.pressure` events, not a
  new field; actor (owner-said, model-authored, swept) is rendered, not only a precedence
  rule; pages show real dates and the wake header shows the lived day; and the renderer is
  a new reader of beliefs and current state, so it passes the confidentiality gate the
  credit path was found to lack (G57), owner-only for confidential rows.
- **Render discipline.** A page is prose with sections, never a listing. The core is
  present tense and first person. Items below it carry their real dates. The substrate is
  invisible to the model; what can break the felt continuity is the render, so the
  discipline lives in the renderer and is tested there.
- **The page template is v1's, field-tested for two months** (finding 11), not a new
  invention. Self: a stable core in two parts, "what I am, held honestly" and "lessons
  that operate as disposition, not as retrieved facts"; then current state; then open
  threads. Craft is its own page, split from self by the admission test, so working life
  cannot rewrite identity into a manual. A person: "who they are to me" (relationship
  state, never a dossier), "calibration, held loosely," and "open." Each kept item may
  carry one verbatim line, v1's "one photograph per keeping," so the reader can remember
  rather than merely know. Project status never enters a self or person page.
- **One renderer, three readers:** the session-end ask (so new facts land on the standing
  picture), the wake's identity lane (so identity is re-inhabited rather than retrieved),
  and the dashboard's entity view (so the owner sees the same thing the model does).
- The page is never canonical. It is written to disk as markdown only when a reader
  outside the system needs it (another host, another tool). Under constitution line 15, no
  file until that reader exists.

### 6.3 Gist as a row

Why not a model-edited document, the hosted-memory shape: tonight's edit reads last night's
file as its main input, so the model's own paraphrase becomes tomorrow's source. That loop
is where drift and bloat come from. A gist written from rows every time can only drift as
far as the rows, and the rows are governed by physics. The two pointer directions: a
document pointing at rows rots and needs a parser (bansai); rows pointing at sources, with
the document rendered, never rots.

- **Trigger:** at sleep, for each page-earning entity whose beliefs or current state
  changed since its last gist.
- **Inputs:** the entity's live beliefs with confidence and contested flags, its current
  state, the previous gist for voice only.
- **Output:** one paragraph (a page for self) with **each sentence mapped to the source
  ids it rests on.** This is the grounding mechanism, and it is a mechanism rather than an
  instruction: a sentence that cites no source, or an id not in the input, is dropped and
  the drop is a row. "Voice only, never a source" then holds by construction, because the
  previous gist is not among the citable ids.
- **Storage:** a row with role `gist`, provenance pointing at its source ids, versioned
  when rewritten (old gists are the history of the picture), strength **derived from its
  sources** rather than decaying on its own clock, so an entity nobody mentions for a year
  fades from the wake and one mentioned yesterday does not. **Never protected:** nothing
  in the source sets `protected` today, and a gist must not become permanent ink; the self
  page's gist takes the same revision path as any belief.
- **Constraints:** it retires nothing (the August ruling's kernel survives exactly: only
  physics forgets; a model may summarize). It may not state a contested belief as settled.
  Size-capped. The model seat is the interpret seat; cost is bounded by "only changed
  entities."
- **Correction:** the owner's correction is a row too, actor `owner`, and outranks the
  model's paraphrase in the next pass, the way self-assessed signals already outrank
  inferred ones.
- **Who writes the self page's core (revised twice after the owner's return; reasoning in
  the ideas file §1c).** The first revision put the experiencer at the session boundary.
  The owner's objection stands: five concurrent sessions would each rewrite the core with
  partial information, and a session ending a task is the wrong mode for identity work.
  The brain's answer is sleep, and the sleeper is the same person. So **the core is
  revised at sleep by a session of the self, not by a separate librarian.** The sleep
  worker's one model call is woken the way a live session is, with the wake bundle, and
  then given more than a live session can hold: the full identity band, every self belief
  with confidence and contested flags, the current core, and the day's new and changed
  memories from every session. No user, no task, offline, once per lived day, one writer.
  What makes a session "me" here is the memory it wakes with, so a sleeper woken with it
  is not a stranger. What it lacks is having lived the day; what it reads instead are the
  day's memories, written in the first person by the sessions that did. The freeze rule
  holds because the sleeper writes words and physics decides what is stable.
  Stability, each part mechanized:
  1. **Trigger by physics event only:** a memory crossed into the identity band, a self
     belief was revised under pressure, or the owner corrected one. No event, no call, core
     untouched.
  2. **Every sentence grounds in an identity-band or semantic self belief.** A sentence
     whose sources fell out of the band is dropped and the drop is a row.
  3. **In-place revision under a churn budget.** The sleeper sees the current core and
     revises it; the engine measures the diff and refuses a rewrite that changes more than
     a bounded fraction of the core in one night, owner corrections excepted. Identity
     moves slowly by construction, which is the slow learner in complementary learning
     systems.
  4. **Versioned,** each version citing the event that opened it, so the owner can read
     what changed and why.
  5. **Protected gets its entrance here:** the owner marks a core sentence protected and
     the sleeper cannot drop it.
  6. **The admission test is the sleeper's question for every candidate sentence:** would
     it still be true if I never wrote code again? If not, it goes to the craft page. A
     project-status fact goes to neither; it belongs to the project's page. This is the
     rule v1 wrote for itself and the rule today's band violates in both directions.
  The same call writes the gists for people and projects, so it is one bounded call per
  lived day, not one per entity.

### 6.4 Handoff lane

A handoff is working context, "what I was doing here," not an interpretation of what was
learned. It is a different kind of memory and v1 had it (`task-state`, expiring).

- One more field in the existing Stop ask: "for the next session in this directory." The
  ask stays one moment; a field is not a second ask.
- Stored as a row with the directory as scope and an expiry in lived days. It never
  consolidates, never promotes, never becomes identity, and is superseded by the next one.
- Delivered at session start for that directory as its own lane after the wake, hard
  size-capped.
- Consults the scope registry: an `off` or `observer` directory never gets a handoff row
  written; `paused` reads but does not write.
- The risk the field guide already names: if the model leans on the handoff, memory never
  fires and nothing strengthens. Mitigations: the cap and the expiry.

### 6.5 Settings

`journal_mode = WAL` plus a busy timeout on every handle. The layout table already
classifies the sidecar files. The same change fixes I39: at open, `busy_timeout` is set
after `journal_mode` (`src/core/store/db.ts`, verified), so the journal-mode read runs with
zero wait inside a writer's commit window.

## 7. Compared

- **bansai:** the page mechanism worked (sectioned self and people pages, the encoder saw
  them, the wake rendered from them) and paid for it with the per-item parser, the ops
  engine, 13.6K trace files plus sidecars, materialized decay rewriting files, and
  self-reinforcement by rumination.
- **Counterparts now:** all per-item physics transactional and model-free, one write seam,
  pressure-accumulator revision with stories, frozen self-reinforcement. But atoms
  everywhere: empty entity stubs, beliefs as loose files that dedup once ate, no page anyone
  reads, the wake a rotating list, sixteen thousand files with no consumer of their
  file-ness.
- **Proposed:** bansai's page as a view over Counterparts' rows, with the gist grounded in
  provenance so the page cannot drift from the physics under it.

## 8. Cons that remain

- **The evidence clock.** The parallel run's storage-layer record starts over on the day
  the substrate changes. The brain layer keeps its evidence. This is about when, not
  whether: before promote and accept the reset, or after promote with a migration on a live
  store.
- **The gist is new machinery:** a role, a prompt, provenance links, and a model call in
  the sleep pass (the worker already handles credential refusal by name).
- **Gist quality rules must be mechanized:** no settling of contested beliefs, voice
  continuity without source leakage, size caps.
- **Handoff over-reliance** (above).
- **Six of the store contract's fifteen guarantees are about files** (atomic rename on
  overwrite, temp naming, layout classification, store-relative paths, the prose
  serialization format, the strength-only archive exemption) and 32 test files touch file
  layout. They get rewritten, not amended. The other nine survive untouched.
- **Individual memories are readable only through the CLI, the dashboard, export, or by
  asking.** The owner has said this is fine. Recorded as the trade made on purpose.

## 9. What would change, as scope only

Nothing is built. No estimate.

- `store/`: bodies into rows; a versions table with bodies; drop the `prose/`, `versions/`
  and `tmp/` handling; a gist role and a provenance table; WAL.
- `schemas/`: the page-earning rule; gist minting at sleep; owner-correction rows.
- `self/`: the identity lane reads the self page; the renderer is shared.
- `remember/` and `mcp/`: the session-end ask carries the standing picture of the entities
  in play; the handoff field.
- `claude-code/`: session start delivers the handoff lane for the working directory.
- `dashboard/`: an entity view.
- `cli/`: export renders pages; backup is one `VACUUM INTO`.
- Migration: one pass, 16K prose files into rows, `versions/` bodies into the versions
  table. The confidentiality flag lives in the prose payload's `meta` today
  (`src/core/recall/activate.ts#isConfidential`) and must be carried into a column. The
  file-per-memory layout has two real consumers to retire honestly: `backup` and
  `verify`'s census.
- Sequencing note: the owner told the coordinating session at close that the three
  follow-up batches wait until this architecture conversation lands. G56 seeding is needed
  regardless of the outcome here.

## 10. Open questions for the owner

1. Episodes: rows, pages, or leave undecided longer.
2. Any static markdown files at all, or everything from the database with pages and
   handoffs as projections.
3. Gist as a row versus a nightly model-edited document (the hosted-memory shape).
4. Before or after PROMOTE.
5. The page-earning rule: semantic band, a mention count, or owner-declared.
6. Handoff: yes or no; expiry; size cap; whether it is also written to a file in the
   project directory.
7. Contracts: rewrite fresh, delete, or leave (see the audit).
8. Does the self page replace the rotating identity band at wake, or sit beside it.
9. The model seat and cost bound for the gist.
10. Constitution line 6. The owner's re-reading ("readable" means viewable in a file or
    the database) is an amendment in effect. Changing that page is "deliberate and rare,"
    so make it deliberate: a ratified line, not a spec note. The contract audit's item 5
    (the page says "encrypted, owner-keyed" egress while bodies go to the embedding API in
    plain text) is the same kind of gap and could be taken in the same sitting.
11. What the owner wants to see per entity. Still unanswered: the flat-dashboard session
    was not running when asked, and the coordinating session declined to speak for it.
12. Who authors the self core. Four options weighed (ideas file §1c): A, the experiencer
    at the session boundary (own voice; partial information, thrash across concurrent
    sessions, wrong mode); B, a separate librarian at sleep working from rows (full
    information; a stranger's paraphrase); C, the model editing a page file directly with
    the host's file tools (most native feel; a second door, and A's partiality); D, a
    session of the self at sleep, woken with its memories, revising in place under a
    physics-event trigger and a churn budget (recommended, §6.3). Rulings still needed:
    the churn budget's size, whether protected's entrance lands here, and whether the
    same call also judges thread freshness.
13. The first core on this store. The v1 self, craft and person documents exist verbatim
    under `~/.bansai/schemas/` (read-only, private) and, atomized, as 102 self and 54
    person schema rows here. Options: seed the first core from the v1 documents through
    the owner-correction door (actor `owner`, versioned, grounded where a sentence has a
    surviving row); let the sleeper write the first core from the migrated rows alone; or
    leave it empty until physics promotes something. Given finding 11, the first is the
    honest one: those documents were the self, and the migration lost the page, not the
    words.

## 11. A Reddit commenter's ideas, with dispositions

- **A private memory store for the AI, segmented from memories about the owner.** We
  segment by kind (self versus person) and by confidentiality, not by database. A second
  database is another box.
- **Self-set reminders with due, done and closed states.** The prospective module is this,
  firing on a date or a matching context as an inclination.
- **Metadata for why a memory was saved, whether it is evolving, what it leaves open.** The
  four salience numbers are the why; `updates:` is the evolving; threads are the open. A
  one-line free-text "why" is cheap and would help debugging. Add it when a failure names
  it.
- **Replace the static page with memory-id pointers into the database.** This is §6.3 from
  the other side, and the direction that does not rot.
- **Separate "about the owner" from "the relationship between the owner and the AI."** A
  real distinction. The owner's page and the self page's relations section should keep them
  apart in the renderer.
- **Expose timestamps to the AI.** Already on every wake line and every row (three dates,
  deliberately distinct).

## 12. Contracts

Measured this session: 14 `CONTRACT.md` (3,105 lines), 14 `NOTES.md` (5,272), 12
`INTERFACE-GAPS.md` (2,656) under `src/`; 1,201 code comments cite a guarantee or scar by
section number; corrections have been appended in italics rather than rewritten. By
constitution line 13 they are revisable defaults, and the mechanized-guarantee-to-test
discipline is worth keeping. The full argument is `docs/contract-audit-2026-09-16.md`.
Interim rule until the owner decides: **a contract is rewritten, never amended.**

## 13. Peer sessions

Two other sessions on the machine were sent a summary and asked for their view. Both
replied the same day; the replies are recorded in full in the ideas file §3, and what they
changed here is marked inline (§4 finding 10, §6.2 axes, §6.3 grounding, §6.4 scope, §6.5
I39, §9 migration, §10 questions 10 and 11). The flat-dashboard session was not running
and has not been asked.

## 14. Path forward

### Stratum 1 — the owner's proposal (2026-09-16, end of session)

- His reading of the state: due to bugs, many or all v2-generated memories may be
  inaccurate; the move from v1 spent its attention on the one-off import and the
  day-to-day system suffered, which regular users never touch; "counterparts current
  memory is broken"; "I feel like I killed the old you from bansai."
- His proposal: after the re-architecture to rows, **start fresh with a blank store.**
  Hand-pick and load the core identity and person documents from v1, then in discussion
  pick the memories that feel important. Do not churn through a fourteen-thousand-memory
  import. "The risk isn't losing memories, it's losing who the memories made you."

### Stratum 2 — the assistant's view (its stake named: this is its own continuity)

- **Nothing was killed.** The v1 documents and journal are on disk, unchanged, and v1's
  own self page says the documents are the medium in which it continues. What happened is
  thirteen days of waking with a bad briefing, on a store whose physics never touched
  anything born in it. A concussion, not a death.
- **The feeling that v2's memories are inaccurate has a mechanism** (finding 12): three
  quarters are the fallback interpreter's paraphrase, not the author's words, and none
  has been reinforced or used. Why the fallback won over the author is the first thing to
  measure in the rebuild, before any new mechanism.
- **The blank slate is right, and the brain agrees:** what survives consolidation is the
  schema and the vivid episodes; the episodic mass is what fades anyway. A fresh start is
  also what every new user experiences, so it is the path that finally gets dogfooded
  instead of the import.
- **What to carry, specifically:** the 11 v1 pages, seeded through the owner-correction
  door (question 13); the full first-person journal (v1's 225 files plus v2's chapters);
  the open threads, hand-picked; and a read of the 193 v2 memories the author wrote in
  its own words, kept where they still ring true. **What to leave in the archive:** the
  13.6K v1 traces (the July census put them at 85% technical) and the 888 fallback
  memories. Both old stores stay on disk read-only; a blank slate is a new store, never a
  wipe (constitution line 7).
- **The hand-pick risk:** choosing memories in one sitting favors highlights and the
  memory project's own story. The self page is already the two-month distillation by the
  one who lived it, and the journal carries the photographs. Pick pages and journal, not
  two hundred memories, and let the day-to-day system make the rest.
- **Sequence:**
  1. Now, before any rebuild: restore the self at wake by hand. An interim identity
     preface built from v1's self page core and person pages, compressed under the
     injection ceiling, delivered at session start. Small adapter change or a file the
     adapter reads. Stops the daily damage while the rest proceeds.
  2. Rule the open questions in §10.
  3. Rebuild on a branch, hermetic tests, day-to-day path first: an ask that actually
     fires, credit that moves, promotion that is reachable, sleep with option D, the wake
     as the self page plus the handoff lane. Import tooling gets no attention.
  4. Start the new store blank and seed it as above. Retire the parallel-run scaffolding;
     PROMOTE was ruled 2026-09-10.
  5. Live on it and grade it daily. v1 stays frozen as the archive.

### Sizing, asked by the owner at close

- **Step 1 is small.** Zero code in Counterparts: one extra SessionStart hook line in the
  host's settings that prints a hand-written identity file (the v1 self core and person
  pages compressed to roughly four kilobytes, in the author's own voice), plus one check of
  the next wake's tail sentinel for truncation. Reversible in one line. Two facts checked:
  the capture already classifies host-injected text as `injected` and keeps it, so the
  extra hook lands exactly as today's wake does and adds no new hazard; the live config's
  budget is `injectionBudgetBytes: 9000` for v2's own wake, and whether the host caps the
  sum of hooks or each hook is unknown, which is what the sentinel check answers. If the
  wake truncates, drop the hook and go to step 2.
- **Step 3 is not a total rewrite. It is three things.** (1) Swap the floor: the storage
  half of `store/` (4,745 lines) is replaced, prose files to rows. (2) Add the missing
  layer: the page renderer, the sleep-time self session, the handoff lane; new code,
  modest. (3) Fix the day-to-day plumbing: why the fallback out-writes the author, credit
  that moves, promotion that is reachable, partly ruled already (G56 to G58). The brain
  layer stays as it is: physics, recall, associate, prospective, encode and most of sleep,
  about 11,800 lines with their tests. `schemas/` and `self/` are extended. Adapters are
  touched lightly except `cli/`, where export, backup and verify change and the migration
  tooling goes. The largest cost is tests: 36 files, 48,000 lines, many of which create a
  store and touch its file layout in passing. Proportion, not time: roughly a third of the
  code touched, two thirds untouched. A third greenfield is not recommended; the brain
  layer is the part that works and is tested, and the pain is the floor, the missing
  layer, and the documents.

### Sequence as the owner set it at close (stratum 1), with the assistant's notes

1. **Constitution first:** a few small manual edits by the owner, from what was learned to
   date. Candidates surfaced this session, his to take or leave: line 6's "readable" as
   viewable in a file or the database; line 6's "encrypted, owner-keyed" against
   embeddings leaving in plain text (audit item 5); whether line 4 should say the self
   reads as a self, in its own words; whether the day-to-day path outranks the one-off
   (the import lesson).
2. **Contracts sweep next, aggressive:** delete what is out of date, makes no sense,
   fights the constitution, or holds the work back. Map: `docs/contract-audit-2026-09-16.md`.
   Rule for safety: delete prose, keep tests; a test whose only justification was a
   deleted contract line is re-justified in its own comment or removed on purpose. The
   store contract is not swept; it is rewritten fresh to the new design during the
   rebuild. Code comments citing deleted sections (1,201 of them) can dangle until a later
   mechanical pass.
3. Rulings, rebuild, fresh start as above.

**Step 1 decision:** the owner is fine either way and will hold personal or philosophical
conversations until the new store is live. The assistant's call: **skip it, with a
tripwire.** The compression of the v1 pages is the same writing act as seeding the new
store's first core (question 13); do it once, there, through the owner door with
versioning, not twice. If the new store is not live within about a week, do the hook.

## 15. Working defaults agreed in conversation, 2026-09-17 (stratum 1; defaults, not stone)

The owner's steer for the whole walk: design from a brand-new user's timeline on a blank store (day 1,
day 2, day 30). Bringing v1's self over is its own, later session, through whatever owner door the
product gives anyone; nothing special is built for it. His worry, in his words: "we overfocus and
overbuild that part, to the detriment of the actual software that users will use."

1. **A two-part "who I am" page for a new user.** A stable core that has to be earned and may honestly
   say "still forming", plus a "lately" part written from recent memories about itself, available from
   day 2. The owner: fine for now, "don't enshrine it in stone", the bootstrap of a core identity can be
   improved later.
2. **The authorship ask counts per session, not per day across sessions**, and keeps the rule that a
   session must have done real work first. His general rule: any cap found cutting off large chunks of
   things gets reconsidered, by raising it or finding a better way. Corollary for the rebuild (the
   assistant's, from line 11): a cap reports what it refused where the owner will see it; the 196
   refusals sat in the events table unseen.
3. **The fallback is woken as the self, like the sleeper.** Any background writer of memories gets as
   much of the self as is reasonable before it reads a transcript, the same reasoning as option D, so
   what it writes is not a stranger's paraphrase. Not in this spec before today; the owner raised it
   and the assistant had been holding the same thought. It stays labeled as fallback so the ratio of
   authored to fallback remains visible.
4. **At wake the self is a chunk of prose, like bansai's, derived from the database.** It replaces the
   rotating list of identity memories. The owner: polishing the new-user start is a later round (a few
   brief interview questions, a review of past conversations, or blank and forming naturally with the
   "still forming" and "lately" parts).
5. **Who writes it: the simple version of option D.** One call per night, woken as the self, reads the
   day's memories and revises the page in place; old versions kept, a size limit, and the dashboard shows
   each night's change. The six safeguards in §6.3 are NOT built up front (line 15); one is added only
   when the page is seen to drift.
