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
