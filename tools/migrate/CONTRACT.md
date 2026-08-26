# `tools/migrate/` — CONTRACT

## 1. Purpose

The one-way cutover: read a v1 (bansai) data directory and build a fresh v2 (Counterparts)
store from it, so the owner's month-of-memory arrives in the new engine instead of being
left behind on the old one.

It is a **consumer of v2's public API**, not a friend of its internals: `Store`,
`Counterpart`, `Schemas`, `Self`, `encode/`. It reaches into no module's private state and
it re-implements no rule that lives in `src/core/`. Where v1 and v2 disagree about the
shape of a thing, this tool is where the disagreement is written down — never where a new
rule is invented.

It is also, deliberately, the **most gated write path in the repo**. v1's own migration
path bypassed its secrets gate and put three live Google API keys into the store across 17
traces (scar §7a; `docs/harvest/test-triage.md` names re-deriving that lesson as the one
thing the v1 test spine proved worth carrying). Guarantee 1 exists because of that
incident, and it is enforced structurally rather than promised.

## 2. Brain analog

None — a migration is not a memory operation. The nearest honest analog is **systems
consolidation across a substrate change**: the trace moves, the physics that governs it is
recomputed by the new substrate, and what cannot travel is named rather than mimed.

## 3. Inputs — the v1 data-dir layout

Read-only. Learned from v1's own source (`~/bansai/src/`), never imported from it.

| Path | Shape | What it holds |
|---|---|---|
| `traces/**/*.md` | flat-YAML frontmatter + prose body | the interpreted episodic items (scope subdirs: `global/`, `project-<slug>/`) |
| `episodes/<date>-<marker>[-N].md` | optional flat-YAML frontmatter (`when`, `salience`) + first-person prose | the session-authored journal |
| `schemas/*.md` | flat-YAML frontmatter + `## Section` headings whose items are `- <visible> <!--{json}-->` lines | entity schemas: `self.md`, `craft.md`, `person-*.md`, `entity-*.md`, and any other kind |
| `graph/edges.json` | `[{src,dst,type,weight,valence,updated}]` | the Hebbian/typed edge graph |
| `prospective.json` | `{ traceId: {windowKey, firedDays[], referenced} }` | the prospective firing ledger |
| `ledger.json` | `{ id: LedgerEntry }` | the surprise ledger (open questions about beliefs) |
| `meta.json` | `{activeDay, cycle, lastSessionDate, …}` | the active-day clock |
| `config.json` | owner config overrides | read for context; never applied to v2 |

**Frontmatter dialect** (v1 `store/files.ts`, reimplemented here as a reader, not copied):
`key: value` lines between `---` fences; values are string / number / boolean, arrays as
JSON; `"…"` and `'…'` quoting; numbers including exponent notation; multi-line values do
not exist. Unrecognized keys are preserved (v1 G6, the metadata-loss incident).

**Item lines** (v1 `model/schema-md.ts`): the visible text is cosmetic; the trailing
`<!--{…}-->` JSON is authoritative and is the only thing this reader parses.

## 4. Output

A fresh v2 store at the target directory, in the layout `store/paths.ts` classifies:
`prose/`, `versions/`, `operational.sqlite`, `cache/`, `spans/`, `tmp/`. Nothing else is
written into the target — an unclassified top-level entry would make the next
`Store.open()` throw (`assertLayoutClassified`), so **the migration report is never
written into the data dir**: it goes to stdout, or to a path the caller names outside it.

## 5. Guarantees

Each one names the mechanism that makes it true and the test that proves it.
Tests live in `test/migrate.test.ts`.

**G1 — Every body crosses the full encode battery.**
No prose becomes canonical in v2 without passing `encode.gateProposal()` — traces,
episodes, every schema statement (core, current state, relationships, threads, beliefs,
protected, self-index), and every identity document. The gate's OUTPUT text is what is
written, never the source draft. The span handed to the battery is the body itself, so the
precision gate finds every specific sourced and hedges nothing — an import is not an
authorship claim, and this tool must not rewrite the owner's words except where the gate
redacts a credential.
*Mechanism:* one chokepoint, `gate.ts#gateBody`, called by the planner; the writer accepts
only gated text and there is no second path to `store.put`.
*Test:* a fixture trace carrying a fake Google API key arrives with `[REDACTED:` in its
body and the raw key present nowhere in the target dir; the gate fire is counted by family.

**G2 — `confidentiality: sensitive` survives the crossing.**
Every v1 trace's confidentiality class is written to `meta.confidentiality` on the v2
prose payload, which is the field `recall/activate.ts#isConfidential` reads and
`recall/gate.ts` enforces as `confidential-withheld`. A class of `sensitive` or `private`
therefore stays withheld from non-owner recall in v2. This closes BUILD-STATUS gap 5 (v1's
live store carries 16 such traces; `isConfidential` had a reader and no writer).
*Test:* a `sensitive` fixture trace round-trips to a v2 doc for which `isConfidential()` is
true; a `normal` one is false.

**G3 — Protected stays protected.**
A v1 `protected[]` item lands as a v2 element with `physics.protected = true`; so does a
self-index entry carrying the author's `verbatim: true` flag (v1's permanent-ink marker,
set only by the owner's CLI). Protection is a per-row flag in box 2, so
`self.enumerate()` lists them on the other side.
*Test:* protected items and `verbatim` self-index entries are `protected` in
`self.enumerate()`; ordinary core statements are not.

**G4 — Physics maps explicitly. Every approximation is named, counted, and tunable.**
See §6. No physics field is silently defaulted; each rule is a named constant in
`tunables.ts` and each application is counted in the report's approximations table.
*Test:* `sal(m)` of a migrated memory equals the v1 trace's `salience` to within float
epsilon; `uses`, `birthDay`, `lastUsedDay`, `protected`, `promotedIdentity` carry the
documented rule; the report names every approximation it applied.

**G5 — Identity documents land as identity, verbatim.**
`self.md` becomes the v2 identity core through `Self.ensureIdentityCore({name, aliases})`
— the one place a v2 store learns whose it is — and its statements land as self-kind
prose, verbatim (constitution: the owner's words), through `Schemas.addBelief` on that
core. `craft.md` becomes a `skill`-kind entity, which is what puts it in the briefing's
craft lane (`self/identity.ts#rankLanes`). Verbatim means byte-identical to the source
statement, with the single exception of a gate redaction, which is reported.
*Test:* the identity core exists with the source's name; each `self.md` statement appears
byte-identical as a belief body; a craft statement lands `kind: "skill"`.

**G6 — Episodes carry over as episodes, verbatim.**
Each v1 episode file becomes one v2 `type: "episode"`, `kind: "self"` prose document whose
body is the source body unchanged (gate redaction excepted). Episodes are not re-chaptered,
not re-ingested as memories, and not passed through `Self.appendChapter` — that path
advances session state a migration has no business inventing.
*Test:* episode bodies are byte-identical; the count matches; `type` is `episode`.

**G7 — Hebbian edges arrive as v2 edges.**
`graph/edges.json` rows become `store.link({src, dst, weight, day})` with both endpoints
translated to their v2 ids. An edge whose endpoint did not migrate is **skipped with a
named reason**, never silently dropped and never written with a dangling endpoint (box 2
holds foreign keys; one bad endpoint would roll a batch back).
*Test:* a good edge appears in `edgesFrom(src)` with its weight; a dangling one appears in
the report's skipped list with `edge-endpoint-unmapped`.

**G8 — Prospective entries map with their dates.**
Each `prospective.json` entry becomes `store.setProspective({memoryId, windowKey,
eventDate, precision, state, fires})`. The event date's stated precision is preserved
(`2026` / `2026-08` / `2026-08-25`, never rounded — behavioral-spec §4.2). State maps
`referenced → suppressed`, else `firedDays.length > 0 → fired`, else `armed`.
*Test:* an armed and a fired fixture entry both arrive with the right state, fires count
and precision.

**G9 — The run is idempotent.**
Identity is content-derived: a v1 object's v2 id is
`<prefix>_<hashText(sourceKey)>`, where `sourceKey` is its source-relative path plus its
v1 id. A second run therefore recomputes the same address, finds the row present, and
**performs no write** — it does not duplicate, and it does not overwrite. Schema elements,
whose ids are minted by `schemas/`, are keyed instead by their **post-gate statement text**
against the entity's elements, **archived ones included** (a redacted statement re-gates to
the same text, so the comparison is stable across runs; and a v1 belief that arrives
already superseded must be recognized on the second run, or it would be re-added and
re-archived forever).
*Idempotence means "the second run performs zero writes", not "the sqlite file is
byte-identical" — a database's sidecars move on open, and asserting on them would be
asserting on the wrong thing.*
*Test:* run twice; the second report shows every object as a no-op, the id set and content
hashes are unchanged, and `prose/` is byte-identical.

**G10 — The report accounts for everything.**
Counts per kind; gate fires by FAMILY and count (never content, never a hash of a
credential — store §16 G9); every approximation applied, with its count; and every skipped
object with a named reason. **Nothing is dropped silently.** A skip with no reason is a
defect, not a tidy report.
*Test:* the report's per-kind `read` equals `imported + skipped` for every kind, and every
skip entry carries a non-empty reason.

**G11 — The source directory is read-only, provably.**
The reader uses read-only filesystem calls and nothing in this tool ever composes a path
under the source dir for writing. Proof is not a promise: the tool content-hashes every
file under the source before and after a run and reports whether the manifest is identical,
and a source-scan test fails the suite if `read.ts` so much as imports a write API.
*Test:* manifest before == manifest after across a full `--apply` run; the source-scan.

**G12 — Dry-run is the default; `--apply` is explicit.**
Without `--apply` the tool reads, gates, plans and reports — and never constructs a `Store`
or a `Counterpart` at all. That is load-bearing rather than fastidious: `Store.open()`
writes at open (it mkdirs the layout and runs DDL, and BUILD-STATUS records that even an
observer mints an absent store), so a dry run that opened one would leave a store behind.
*Test:* after a dry run the target path does not exist; the dry report's counts equal the
apply report's.

## 6. The approximations

Every row here is a place v1 and v2 disagree. Each is a named constant in `tunables.ts`,
each application is counted in the report, and none of them is silent.

| v1 | v2 | rule | tunable |
|---|---|---|---|
| `salience` (one aggregate, 0–1) | `salience.{novelty,relevance,emotional,predictive,claimed}` | v1 measured ONE number; v2 measures four. The missing dimensions are not invented: `relevance` takes v1's aggregate (the closest single reading), `emotional` takes the typed emotion's `intensity` or 0, `predictive` is 0 (v1 never measured prediction), `novelty` is **null** — v1 never computed prediction error, and a null novelty is the blind-encoding record, never a defaulted zero (scar §2.9). The aggregate is then recorded as the author's **claimed floor**, so `sal(m)` reproduces v1's number exactly. | `SALIENCE_AS_CLAIMED_FLOOR` |
| `gradient` ≥ cut | `promotedIdentity: true` | **The one place migration mints permanent ink.** v2 enters the identity band only by a counted promotion crossing or revision inheritance; a cutover is neither. Rather than let a v1 identity-band trace silently demote at the first decay pass, a gradient at or above the cut arrives already promoted — counted in the report, and disabled by setting the cut above 1. | `IDENTITY_GRADIENT_CUT` (0.85 = v2's `THETA_ID`) |
| `gradient` ≥ semantic cut | `band: "semantic"` | Band is recomputed from strength every cycle, so this is a starting position, not a claim. | `SEMANTIC_GRADIENT_CUT` (0.5 = `THETA_SEM`) |
| `occurrences` (birth = 1) | `uses`, `reinforcedDays` | `uses = max(0, occurrences − 1)`: birth is not a use. v1 reinforced at most once per lived day, so `reinforcedDays = uses` is near-exact. | `BIRTH_IS_NOT_A_USE` |
| `createdActiveDay` | `birthDay` | Exact — both are lived-day integers on the same clock, which is why the clock is set before any write (below). | — |
| `lastReinforcedDay` (calendar date) | `lastUsedDay` (lived day) | There is no calendar↔lived-day map: lived days skip days not lived. We have exactly ONE anchor — `meta.activeDay` ↔ `meta.lastSessionDate` — so a stamp equal to the anchor converts exactly, and every other stamp **falls back to `birthDay`**. The fallback is the conservative direction: it can understate recency and therefore strength, never overstate it. | `LAST_USED_FALLBACK` |
| `meta.activeDay` | the v2 lived-day clock | Set through `store.setMeta("livedDay" / "lastActiveDate")` **before any `put`**, so imported `birthDay` values land on the same axis the decay curve reads. Advancing through `advanceClock()` would require inventing N fake calendar dates. | — |
| `confidentiality` | `meta.confidentiality` | Exact (G2). | — |
| `scope` | `meta.scope` | v2 memories carry no scope column — scope lives on spans. Preserved as metadata so nothing is lost and a future scope-aware read has it. | — |
| `emotion {subject,core,shade,intensity}` | `meta.feeling` (type), `meta.feelingSubject`, and the `emotional` dimension | v2's durable feeling is `{type, subject}`; the shade and intensity have no durable home, so the intensity is spent on the salience dimension and both ride in `meta`. Retro-typing is forbidden either way: a v1 null emotion stays null. | — |
| `merged_into` | `meta.mergedInto` + `archive(reason)` | **A named gap, not a mapping.** v1's merges are many-to-one (many sources, one gist successor); v2's supersession is a one-to-one forwarding chain. Faking a chain would invent lineage. Sources arrive archived with the pointer in meta and in the archive reason — nothing is lost — but `store.resolve()` will not forward a v1 merge. | `MERGE_AS_ARCHIVE` |
| `archived` / `archiveReason` | `store.archive(id, reason)` | Exact. Archive is a state, not a deletion (§4.2 G3). | — |
| `taskState` | `meta.taskState` | Carried as metadata; v2 has no task-state expiry path yet, and inventing one here would be a rule with no home. | — |
| `aliases`, `handles` | `meta.aliases`, `meta.handles` | Each is scanned for credentials individually (a credential must never become an entity the store indexes) and dropped with a counted reason if dirty. They are **not** routed through the battery's alias gate: that gate drops any alias not verbatim in the span, and v1's aliases are gazetteer cues that frequently are not — using it would silently strip legitimate retrieval keys. | `ALIAS_SECRET_SCAN` |
| `eventDate` → `happenedOn`, `created` → `learnedOn`, `title` → `title` | | Exact, precision preserved. | — |
| `lastDecayedDay` | dropped | v2's decay is idempotent per (row, lived day) inside `sleep/`; a v1 replay marker has no meaning on the other side. Counted as dropped. | — |
| edge `type`, `valence` | dropped | v2 edges are `{src, dst, weight, day}`; the typed/valenced graph has no v2 home. Counted as dropped, with the type histogram in the report so the loss is a number. | — |
| prospective `firedDays[]` | `fires` count only | Same missing calendar↔lived-day map; the count is the brake that matters, the last-fired lived day is dropped and counted. | — |
| `ledger.json` entries | counted in the report; not durable in v2 | **Deliberately NOT mapped to `pressure`, and the mapping ships disabled.** v2 fires a revision at `pressure ≥ iota × strength(target)`; v1's `cumulativeScore` was accumulated by different arithmetic against different strengths. Injecting it risks a spurious revision on the first real challenge in the new store — machinery added in anticipation of a failure (Amendment 15's exact prohibition). Every entry is reported with a named skip reason (`ledger-open-not-mapped-to-pressure` / `ledger-closed`), and turning the tunable on **throws by name** rather than quietly doing nothing: a switch that is on and inert reads as a mapping that happened. | `LEDGER_TO_PRESSURE` (default `false`) |
| v1 schema and episode birth days | the cutover day | Neither a v1 schema nor a v1 episode file carries a lived day. They are born on the day the migration runs, counted — rather than assigned a lived day nobody ever computed. | `ENTITY_BIRTH_IS_CUTOVER_DAY`, `EPISODE_BIRTH_IS_CUTOVER_DAY` |
| belief `provenance`, `confidence`; relationship `entity`; self-index `pointers`, `shelfQuery`, `warmth` | dropped (warmth becomes the claimed floor) | `Schemas.addBelief` takes a statement, a day, a protection flag and a claimed salience — and this tool is a CONSUMER: it does not reach past the public API to bolt a metadata channel onto an element. v1's `provenance` is a list of session refs while v2's `groundedIn` wants memory ids — the same shape meaning different things, so it is dropped rather than mistyped. Every drop is counted by field name. | — |

**Routing of v1 objects with no exact v2 home:**

| v1 object | v2 home | why |
|---|---|---|
| `self.md` sections | identity core + beliefs on it | G5 |
| `self.md` `currentState[]` | ordinary self-kind **memories**, not elements | `Schemas.addCurrentState` refuses status on the identity schema by name — the ~72 KB lesson mechanized at that seam. The refusal is right; losing the owner's prose is not. It lands as memory, and the report counts the route. |
| `threads[]` | memories with `meta.unresolved = true` | v2: "an open loop is an ordinary memory with a flag", and `unresolved` is what puts it in the briefing's threads lane. |
| `relationships[]` | beliefs on the entity | closest live home; the v1 `entity` label is dropped and counted (above). |
| `superseded[]`, `archivedCore[]` | archived self/entity-kind memories | pure lineage records; they keep their text (never-destroy) and stay out of the live set. |
| `selfIndex[]` | beliefs on the identity core; `verbatim: true` ⇒ protected | G3. |
| a `fact`-kind v1 schema | its statements as `fact`-kind memories | `fact` is not a birth kind in v2 (a fact is a memory, not a thing memories attach to). Counted with reason `schema-kind-has-no-entity-home`. |

## 7. Non-goals

- **No reverse migration.** v2 → v1 is not a thing this tool does.
- **No model calls, no network, no embeddings.** The target's cache is left to
  `rebuildCache()`; the report declares embeddings un-recomputed.
- **No log/telemetry import.** v1's `logs/` are bounded-retention telemetry, not canonical
  memory, and they do not travel.
- **No transcript/span import.** `buffer/` and `buffer-archive/` are raw material for the
  replay harness (`tools/replay/`), not for the store.
- **No repair.** A malformed v1 file is reported and skipped; it is not guessed at.

## 8. Lineage

- **[v1]** the object taxonomy, the frontmatter and item-line dialects, the three-dates
  rule, the never-destroy posture: `docs/harvest/behavioral-spec.md` §4.2–4.3.
- **[v1, the scar]** the migration secrets-gate lesson: `docs/harvest/test-triage.md`
  (`migrate-secrets-gate.test.ts`) — *a bulk-import path is secrets-gated exactly like any
  other write path*. Guarantee 1.
- **[v2]** BUILD-STATUS gap 5 — the confidentiality writer. Guarantee 2.
