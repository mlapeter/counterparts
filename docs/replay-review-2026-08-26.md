# Replay run review — 2026-08-26 (run_6b037641d8aa, Opus 5, as-shipped)

The deep review of the first real replay: four parallel reviewers (memory quality
on Opus; scorecard arithmetic, telemetry audit, and decay physics on Sonnet), each
blind to the others' work and to the coordinator's hypotheses, plus the
coordinator's own code-level verification of every load-bearing claim. Scorecard:
15 pass / 10 fail / 2 needs-rater / 23 not-exercised — NOT a clean pass, gate
stays shut. Artifacts: `~/counterparts-replay-runs/opus5-as-shipped-2026-08-26/`.

The verdict in one line: **the physics and the discipline layer are sound; the
run's real teachings are one P0 durability bug, one trust-grade interpreter
defect, and a set of instruments that read healthier than the store they measure.**

## P0 — verified findings that block the parallel run

### 1. Second failure of the same content is SILENT LOSS (scar E6 broken on retry)
`fallback.ts` sweep cleanup calls `restore(claim, failedSpans)` then
`consume(claim)` — and `consume` appends EVERY claim hash to the dedup ledger
(`consumed.jsonl`), including spans just restored rather than applied
(`spans.ts:679`). Next boundary the restored span is claimed again; if its chunk
fails again, `restore`'s dedup filter (`seenHashesExcludingClaim`) finds the hash
already in the ledger, silently restores ZERO spans while reporting
`restored: true`, and `consume` deletes the claim. The span is then in neither
buffer nor claim — the state spec §2 G6 forbids. Proven live: the 723-byte
`general`-scope span threw on days 12 and 13; the replayed store's
`consumed.jsonl` carries the two identical hash lines; the content never
reappears. `buffer.restoreRate` PASSED over it because a zero-span restore still
counts as restored.
**Fix:** `consume` must record only the hashes of spans actually applied
(exclude the restored set); pin with a test that fails the SAME content twice —
no current test does.

### 2. Owner-name confabulation: 15 durable memories call the owner "Matt"
"Matt" appears in zero corpus files and zero v1 traces; the mint clusters on
days 4/13/19 (per-session confabulation, not one slip), and several are identity
claims about the owner. Compounding: the owner appears under six unresolved
aliases (Mike 386, "the user" 86, mlapeter 46, "the owner" 30, Michael 16,
Matt 15). Two causes, both real: the sweep `SYSTEM_PROMPT` carries no owner
identity anchor at all, and this run also passed no `identity` spec to the
driver (the harness supports it; the runner omitted it).
**Fix:** anchor the owner identity in the sweep prompt from the adapter's
identity config, and pass identity in the replay runner.

### 3. Secrets gate: held on every shipped family — with one real scope gap
Zero credential-shaped bodies among all 1,694 (and one memory carries
`[REDACTED:google-api-key]` — the gate fired in-band on the exact v1 scar shape,
on the new path; the guarantee is now proven, not assumed). But a staff
magic-login URL survived whole: a 16-char bearer token in the URL *path*, which
no `SECRET_FAMILIES` entry covers (`url-credentials` only matches
`user:pass@host`).
**Fix:** add a token-in-URL-path family.
**Owner policy question (not a bug):** no email/phone family exists by design —
38 memories carry emails, 6 carry E.164 numbers (two are third-party staff
personal numbers), plus a Cloudflare account id. Whether personal-contact PII
belongs in the store is a policy call for the owner, recorded here as OPEN.

## HIGH — quality and instrumentation

### 4. The kind vocabulary has no definitions, and filing shows it
`SYSTEM_PROMPT` names the six kinds with zero definitions. Result: `entity` is
~55–60% misfiled (events, PR notes, status snapshots that belong in `fact`);
`place` is 8/8 non-geographic ("where things live": ports, doc paths). `self` is
clean (205/205 genuinely the assistant's), `fact` residual-mild, `skill` the
strongest material in the store. **Fix:** one line of definition per kind.

### 5. Schema birth is refused 98.9% of the time, and nothing watches it
3 births vs 279 refusals all run — 267 of them `name-not-in-source` (verbatim
grounding failing at the mention site), 11 birth-cap, 1 collision-near. The run
ends with 3 schemas against 171 person + 103 entity memories. v1's "zero births"
ambiguity, reincarnated with better telemetry and a single dominant refusal
reason: likely a name-extraction/grounding mismatch, not corpus fact. No
scorecard metric covers birth at all. **Fix:** investigate the grounding
comparison; add a birth metric.

### 6. Three consumers read the birth band column as if it were the live band
By design, box-2's `band` column records only birth (`episodic`) and the
identity crossing (`setBand`'s one caller); the LIVE band is arithmetic,
materialized into the box-3 cache each tick. `dashboard/status.ts` (census),
`dashboard/browse.ts` (`--band` filter — semantic returns nothing, ever), and
the replay driver's own census all read the column, which is why the scorecard
said "episodic=1691" while the physics held ~1,265 rows at semantic-grade
strength. Zero transitions was legitimate (first materialization is deliberately
not a crossing; nothing decayed across THETA_SEM inside 26 days). `schemas/`
already does it right (`bandOfPhysics`). **Fix:** compute live band in all three
consumers; consider whether `list({band})` should refuse or compute for
episodic/semantic.

## MEDIUM — harness validity and metric honesty

### 7. Two metrics cannot fail in this harness
`session.boundaryCoverage`: the driver increments `boundaries` and `sessions`
from the same loop — 100% by construction, testing nothing (v1's own baseline
documents the dropped-end failure it can't reproduce). `band.promotionsPerActiveDay`:
replay drives no turn loop → zero reinforcement everywhere (verified: `uses=0`
on all rows) → promotion's 3-distinct-days condition is structurally
unsatisfiable, so its PASS at 0 is hollow. **Fix:** mark both not-exercisable in
replay (or restructure), rather than rendering hollow PASSes.

### 8. decay.changedShare: scorer bug + a band unreachable for years + a false calm claim
Scorer divides by final-store-size × ticks on a growing store — true per-tick
churn is ~96%, not the reported 56% (two reviewers converged independently on
`baselines.ts:439`). Physics verified correct: with `DECAY_QUANTUM=1e-4` and
S≈60/κ, a row moves daily for ~250–400 lived days after last reinforcement, so
the 2–35% band (from v1's mature store) is unreachable until roughly year one —
and `decay.ts`'s "calm by default / a quiet day writes almost nothing" comment
is empirically false for any young store (harmless — box 3 — but the claim
should match reality). **Fix:** per-tick denominator; maturity-gate the band;
reword the claim or revisit the quantum.

### 9. Interpreter output shape wants teeth
32% of memories are multi-idea (status roundups bundling a session-day);
lexical duplication ~3.5% floor measured on a BLIND config (embeddings cache was
empty — the semantic dedup channel was structurally off this run); heavy topical
re-minting in `person` (41 restatements of one owner trait) is exactly what
preselection exists to suppress. `self` runs +44% relative vs v1's distribution
— v1's identity-inflation pattern, with no freeze-equivalent watching v2's mint
path. Tiny fragments (<1KB) drew prose-not-`[]` from Opus at ~6% of calls.
**Fixes:** one-idea teeth + kind definitions in prompt; fragment floor or prompt
line; a self-share watch; re-measure dedup only after slices/embeddings wire in.

### 10. Self-store pressure valve trips with no relief wired
`self.schema.tripped` fired 7× (72KB threshold; 73.9KB → 83.2KB by run end,
181 → 205 elements) and no compaction/recompression path ever ran. v1 had
autonomous recompression; v2's equivalent is unwired on this path.

## Small
- Renderer: unformatted float in `briefing.budgetUtilization` line breaks
  column padding (report.ts). Cosmetic.
- "sessions 119" (corpus, global) vs "183" (driver, day×session pairs) use one
  word for two units in the same report.
- Two scopes never swept (thin corpus content — benign); nothing left unswept
  at run end; no fragment-junk memories; day-by-day mint volume tracks corpus
  volume with no drift.

## What the run PROVED (the other half of the reading)
Lived-day clock exact (26/26). Briefings never over the 9K ceiling (85%
utilization, max 8,889). Boundary path 100% (with the caveat in §7). Zero cycle
phase failures in 165. Corpus byte-identical, write-probe refused. Totality
tripwire held; all 50 metric verdicts arithmetically correct against declared
ranges (independently recomputed); symmetry watchdog said `never-asked` 156
times rather than lying about starvation. Secrets gate live-proven in-band.
Total mint volume (1,691) lands in v1's neighborhood (~1,443) despite the
harness feeding day-sized mega-chunks — a driver artifact (one capture call per
session-day; capture coalesces a call into ≤2 spans; chunks up to 1.3MB), not
an interpreter pathology.

## The blind second opinion (same day, independent session)

A separate session ran an adversarial review with NO access to this document's
findings ("refute the healthy reading"). Its report (10 findings, F1–F10, the
owner's artifact "Counterparts Replay Audit") converged independently — with
matching file:line cites — on the consume-ledger P0 (its F1, adding the event
fingerprint: `restored {spans: 0, partial: true}` then `consumed`), the
changedShare denominator and the tautological metrics (F3, extending to:
`system.errorRate` counts only cycle phases so interpreter failures are
structurally invisible; `seatRecorded`/`pinnedGeneration` cannot fail;
pass-record strips numerators so a `gateOpen()` consumer can't detect either
defect), the band two-surface split (F6, adding the mechanism proof that zero
transitions was structurally guaranteed in replay: first cache entry lands at
D+1 with no prior, and all 35 borderline rows started below the line — plus:
the whole run's durable event log contains exactly ONE event name), and the
mega-chunk artifact (F4, adding: every corpus turn was role-flattened to
"user", `assistant.jsonl` empty all run; and the report header claims pinned
vectors while `cache.embeddings` held 0 rows).

**Net-new findings from the blind review, verified here:**

- **F2 (CRITICAL): the driver silently dropped 13.2% of the corpus.** The
  capture cursor is keyed per session and persists across days; the driver
  feeds only each day's spans, so a recurring session's day-2 array is sliced
  by day-1's cursor — 115/870 spans (448KB) never became v2 spans, 56
  session-day buckets returned `NOTHING_NEW` (which emits no event), and no
  metric measures corpus coverage. Verified against `spans.ts` cursor writes +
  the driver's per-day feeding (both read here). Rides along: the cursor is
  keyed by session id alone, not (scope, session) — 11 corpus session ids
  appear under multiple scopes — a keying question that may touch PRODUCTION
  capture, not just the harness.
- **F5 (HIGH): salience is self-assigned and shaped the whole store.**
  `salience.lifted` on 97.9% of mints (mean +0.150; mode 0.8): the
  interpreter's claimed floor lifts the computed value at the mint seam
  (`clampSalienceAtSeam` — verified), novelty is NULL without vectors, so no
  independent check exists. That is what put 74.7% of the store above θ_sem
  and 63.8% above the identity base floor — with only `reinforced_days >= 3`
  guarding the identity band. No metric watches lift rate or
  claimed-vs-computed divergence.
- **F7 reframe: the block-rate baseline is mis-ported, not just starved.** In
  v2's shipped battery only three things REFUSE (secret-in-name,
  empty-after-redaction, content floor); alias/precision/emotion degrade and
  accept by design. v1's ~46% has no v2 counterpart mechanism, so
  `gate.chunkBlockRate`'s band compares vocabularies and may never pass even
  with schemas wired. Counted as gates ACTING, v2 sits at 18.9% — order-of-
  magnitude comparable to v1.
- **F8 (MED): 205 self-kind memories minted by the sweep** — the
  transcript-derived self-memory pathway the self CONTRACT forswears
  (rumination/illusory-truth, owner ruling 2026-08-24). The freeze guards only
  repeats; brand-new sweep self-mints pass untouched, recorded
  indistinguishably from authored deposits.
- **F9 (MED): no provenance.** No memory records span/chunk/session/scope
  origin; `gate.chunk` payloads carry no minted ids. Without it, targeted
  redaction/erase and source-level audit — capabilities v1's history says will
  be needed — cannot exist.
- **F10 details adopted:** the 67KB chunk that returned EMPTY with no durable
  record; `effects 18 != accepted 17` on one chunk (unexplained); UTF-16
  chars labeled "B" in `meanChunkBytes` vs UTF-8 in the corpus census.

Each review also found things the other missed (this one: the owner-name
confabulation, kind misfiling, the URL-token secrets gap, schema-birth refusal
anatomy, the self-store valve; theirs: F2, F5, F7-reframe, F8, F9) — the
two-review shape earned its cost. Shared verdict, their words: **"the store
looks healthy; this run does not demonstrate that the system is."** Replay is
a precondition for the parallel run (guarantee 11), and this replay is not yet
a met precondition.

## Follow-ups accepted from the PR-1 review (not in the fix batch)

- **Poison-pill retry is unbounded.** The P0 fix converts silent loss into
  indefinite retry: a permanently-failing chunk is restored and re-swept at
  every boundary forever, one model call each time. Correct trade direction —
  but it wants an attempt count (or quarantine after N) so the fiftieth restore
  is distinguishable from the first. Design-adjacent; queued with the owner
  calls.
- **`scanSecrets` is O(n²) on a long contiguous lowercase run** (~1.5s at 64KB)
  — PRE-EXISTING, shared by every `scheme://` family, verified by the PR-1
  reviewer to predate the batch (it chased its own suggestion as the suspect
  first). Fix is measured and cheap — bound the scheme match to
  `[a-z0-9+.-]{0,32}` (6,750ms → 11ms at 64K, all 21 correctness cases
  unchanged) — queued rather than slipped into the merged branch unreviewed,
  because the gate is the one component that gets no casual edits.

## The re-run that answers everything at once
One more paid run (~$30) after the batch lands: driver capture-per-turn
fidelity + identity passed + prompt (kind definitions, one-idea teeth, fragment
line, owner anchor) + P0 consume fix + URL-token family + schema slices IF the
owner approves the wiring — giving the true before/after on blind-rate, gate
refusals, birth grounding, dedup, and filing quality in a single comparison.
