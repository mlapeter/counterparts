# Contract audit against the Constitution — 2026-09-16

**Scope.** All 14 `src/**/CONTRACT.md` files, `docs/module-map.md`, and spot-checks of the
code behind the clauses I judged (read-only; nothing in the repo was touched). Method: every
guarantee and every "Keeps" clause read against constitution rules 1–16, looking only for
clauses that *fight the thesis* — not clauses that could be improved.

**Verdict in three lines.** The system's self-check is mostly working: eleven of fourteen
contracts open with an explicit **Named deviations (constitution line 12)** paragraph, and
most of them are honest. What has drifted is not the mechanisms — it is the **prose around
them**. Guarantees have absorbed incident narrative until some are 35–45 lines long; a few
sentences state as law a scope wider than the mechanism they describe (the recall clause the
owner ruled on today is one of a pair); and the owner's side of the system has quietly grown
from "one owner operation" into a fourteen-command console with a morning ritual.

---

## Part 1 — Top 10, in plain language

### 1. Both halves of "exposure vs retrieval" are backwards on paper
**HIGH.** Rule 12.

Two clauses say *retrieval never strengthens*: `src/adapters/mcp/CONTRACT.md:26` and its
mechanized twin `:92` ("`recall` and `status` write nothing and train nothing", with a test
that asserts the store is byte-identical afterwards), plus
`src/core/recall/CONTRACT.md:101` and guarantee 8 at `:187`.

Three clauses say *exposure does strengthen*: `src/core/physics/CONTRACT.md:190`
(`w = 0.25 surfaced-unused`), `src/core/associate/CONTRACT.md:13` ("weak when it surfaced
unused"), and `src/core/recall/CONTRACT.md:12-15`.

The brain does the opposite of both: retrieval practice strengthens (testing effect,
spacing); merely being shown something does not. The discriminator that actually works is
the one today's ruling names — *the assistant addressed it by id or handle = retrieval;
the system showed it = exposure.*

Two things make this cheaper than it looks. **The code is already right on the retrieval
half**: `src/core/recall/CONTRACT.md:106-115` credits a memory the assistant expanded or
quoted, and `src/core/counterpart.ts:1410` books that credit at the full `"referenced"`
weight. So clause 1 is three stale sentences and a misleadingly-named test, not a redesign.
**And the exposure half is dead code**: I traced every call site — `W_SURFACED = 0.25`
(`src/core/physics/index.ts:111`) has no live caller; nothing passes tier `"surfaced"` into
`resolveUse`. So the 0.25 tier is documented in three contracts as the live grading and has
never fired.

Note for the owner: deleting the 0.25 tier *changes a named deviation*
(`associate/CONTRACT.md:12-14`, `recall/CONTRACT.md:12-15`), so it is your call, not a
cleanup. The deviation itself ("only a used retrieval reconsolidates") is defensible; what
was wrong was extending its scope to cover deliberate recall.

### 2. "Permanent ink" is the one thing in the system with no way out
**MEDIUM-HIGH.** Rules 7 and 12, plus the system's own scar §2.17.

`src/core/schemas/CONTRACT.md:135-137`: *"Protected elements refuse every revision path, and
their permanence is disclosed: permanent-includes-permanently-wrong is doctrine."*

Everything else in the design brags about naming its exit — `physics/CONTRACT.md:157-158`
("every band now names its way out"), `schemas/CONTRACT.md:141` (every kind reports
created-versus-exited), `self/CONTRACT.md:88-90`. Protection is the exception: it cannot be
revised, cannot be softened, and there is no un-protect command. The only door I could find
is the nuclear one — owner removal zeroes the flag as part of destroying the row
(`src/core/store/owner-op-seam.ts:203`). Brains have no unfalsifiable memories; even
flashbulb memories revise.

The stated defense is legibility: you can *see* the wrong thing forever (the list is in
`counterparts verify` and the dashboard's identity view). That is a real corrective, but it
is the answer to "can I find it", not to "can I fix it".

And the doctrine is currently guarding a door nobody uses. The only writer of
`protected = 1` is `src/core/schemas/index.ts:497-504`, which takes it from an `input`
flag — and I traced the callers: nothing in `src/` ever passes `true`. The one source is
`tools/migrate/apply.ts:293`, the v1 import. So today it is a **dead entrance with a live
doctrine**: permanent unfalsifiable ink, inherited from v1, unrevisable, with `protected.add`
dropped as PROPOSED (`schemas/CONTRACT.md:70-77`) and no un-protect verb anywhere. Decide
the entrance and the exit together.

### 3. Memory has quietly become a chore
**MEDIUM-HIGH.** Rule 8 ("remembering is ambient... deliberate remembering is the
exception, not the interface"), and the system's own line in
`src/core/sleep/CONTRACT.md:68-69`: *"never an owner chore — 'I won't remember to run random
scripts occasionally.'"*

`src/adapters/cli/CONTRACT.md:121` still says: *"Owner-in-the-loop is a short, named list —
currently one item: removal."* The shipped console
(`src/adapters/cli/commands.ts:130-149`, `COMMANDS`) carries **seventeen**: status, install,
init, note, recall, export, backup, remove, verify, migrate-cache, backfill-claims,
repair-dates, repair-merged-beliefs, rebrief, probe-oq4, doctor, credentials.

Separate them honestly. `doctor` and `probe-oq4` are parallel-run scaffolding and retire at
PROMOTE, like `primacy.ts` (`claude-code/CONTRACT.md:82-83`) — fine. But `rebrief`,
`repair-dates`, `repair-merged-beliefs`, `backfill-claims` and `migrate-cache` are permanent
repair verbs, each born from a real incident, none of them scheduled, all of them things the
owner has to remember. Two of them (`rebrief`, `repair-merged-beliefs`) exist because a
*reconciler* was missing — which is exactly what `self/CONTRACT.md:88-90` says every derived
surface owes. The drift is not that they were built; it is that guarantee 12 was never
updated, so the contract reads as law while the console reads as a toolbox.

### 4. Guarantees have turned into incident reports
**MEDIUM-HIGH.** Rules 10 and 16, and the exact mechanism `CLAUDE.md` says it exists to break.

`src/core/self/CONTRACT.md:166-197` is a single guarantee — one paragraph, ~32 lines, five
separate measured incidents, three byte counts. `src/core/sleep/CONTRACT.md:144-188` is
guarantee 9 grown into 9b and 9c over ~45 lines. `src/core/store/CONTRACT.md:174-195` is a
22-line guarantee about an environment variable. `src/core/recall/CONTRACT.md:263-312` is an
open question that is really a lab notebook.

CLAUDE.md designates contracts as where detail lives, so detail is not the problem —
*genre* is. A guarantee should be one sentence a test can check; the story of the day it
was learned belongs in the `NOTES.md` sitting right beside it. As written, nobody reads
these in one sitting (rule 10) and the owner cannot check them at a glance (rule 16), which
means the laminating risk CLAUDE.md names for itself has simply moved one directory down.
This is the clearest signature of the long unattended session.

### 5. The constitution promises encrypted, owner-keyed egress; the system ships something else
**MEDIUM-HIGH.** Rules 6 and 13.

Rule 6: *"Data leaves the machine only by the owner's explicit choice, encrypted,
owner-keyed — never silently."* `src/core/store/CONTRACT.md:97-98` records:
*"Local-only absolutism is released; the property is no silent egress (owner rescope 2,
settled)."* And in practice every memory body is sent to an embedding API, and the crash
fallback sends conversational spans to a generative model.

That is almost certainly the right engineering call, and the clauses around it are careful
(`cli/CONTRACT.md:110-112` tests that nothing opens a socket to a non-model, non-embedding
endpoint). The problem is not the decision, it is where it lives: the constitution's text
and the shipped behavior now disagree, and the reconciliation exists only in one clause of
one module contract, phrased as a rescope rather than as an exception to rule 6. That is a
rule 16 problem — a reader of the one authoritative page gets a promise the system does not
keep. Either amend rule 6 to name the model/embedding channel as the deliberate exception,
or put the deviation at the top of `store/` where a reader will meet it.

### 6. The transcript is the only thing that never forgets — and never passes the gate
**MEDIUM-HIGH.** Thesis 1, rule 3, and rule 6.

Thesis 1: *"Everyone stores the transcripts; the signal is in the structure of
experience."* `src/core/store/CONTRACT.md:168-170` states it as a guarantee: *"Raw
conversational text is not the system of record. The shipped default keeps none."*

But `src/core/remember/CONTRACT.md:107-111` and open question 5 (`:246-253`) say that spans
from normally-ended sessions are never claimed and never retired: `buffer.jsonl` grows
forever. So the store contains exactly one artifact that is verbatim, undecayed, unpruned, and has
no *autonomous* exit — the transcript. (It does have an owner exit: the strike seam,
`remember/CONTRACT.md:199-215`. Nothing retires it on its own.)

The sharper half is the gate. The secrets gate runs when a span is *encoded*, and spans from
normally-ended sessions are never encoded — so `buffer.jsonl` holds, indefinitely and in
plaintext, exactly the credentials `encode/`'s non-ablatable gate exists to keep out of
durable state (`encode/CONTRACT.md:89-91`). That makes this rule 6 as well as rule 3, and it
makes the store guarantee that contradicts it (`store/CONTRACT.md:168-170`) not merely stale
but load-bearing. It is named as an open question, which is honest; the guarantee stating the
opposite as fact is not. Cheapest fix is coverage-driven retirement (already the contract's
own preferred candidate) or an age sweep on the lived-day clock; second cheapest is
downgrading the store guarantee to name the buffer.

### 7. `F_DAY_CAP_SLOW` was added in anticipation, and says so
**MEDIUM-HIGH.** Rule 15 ("machinery is added only after the simple rule fails in real use,
with the failure named — never in anticipation of one").

`src/core/physics/CONTRACT.md:217-225`: the cap was *"added at implementation (2026-08-25)
when the build surfaced that without it one flawless claimed-maximal challenge (F = 1.0)
crosses even the highest self bar (0.9) in a single day."* That is a failure found by
arithmetic on a whiteboard, not one that fired in use — and the honest tell is right there
in the sentence ("making the ratified '~3 lived days' an approximation rather than a
bound").

It matters more than usual because revision has barely ever run: `schemas/CONTRACT.md:110-112`
records that as of 2026-09-04 the live store held *zero* pressure rows, zero `superseded_by`
and zero `revision.pressure` events for its whole life. So the tuned cap guards a path with
almost no evidence behind it. Not necessarily wrong — but it should be marked as a
provisional guard awaiting its first real challenge, not stated as arithmetic law.
(§5.6 as a whole earns a pass: it was rewritten after a *named* review failure, and it says so.)

### 8. Parallel-run needs are pinned into core by tests, with no retirement date
**MEDIUM.** Rules 11 and 13 — a working default that reads as law because a test locks it.

`src/core/sleep/CONTRACT.md:229-233`: `DEFAULT_RETENTION_DAYS = 90` and *"the default is
pinned ≥ 90 by a test"* — because `tools/parallel` reads its evidence off that table.
`src/core/recall/CONTRACT.md:211-215`: the semantic-source field is deliberately kept *out*
of the durable surface set because moving that set mid-run would invalidate carried human
ratings.

Both are correct decisions for today and both encode a *temporary* consumer into a core
module's law. Neither is marked "retire at PROMOTE" the way `primacy.ts` is
(`claude-code/CONTRACT.md:82-83`), which is the pattern that works. One line each.

### 9. The identity lane now runs on a schedule, in a system that says schedules don't decide who speaks
**MEDIUM.** Rule 12, unnamed deviation.

`src/core/self/CONTRACT.md:27-33`: the identity lane *rotates* — least-recently-rendered
first. It was added after a measured failure (the same three of twenty beliefs every day),
so rule 15 is satisfied. But `src/adapters/claude-code/CONTRACT.md:75-77` states the
opposing principle in as many words: *"Computing a parity off an anchor date is not a memory
property and no schedule decides who speaks here."*

Rotation is defensible and probably right — least-recently-rendered is close to the spacing
effect, and repeated exposure to the same three items is the one thing that reliably does
*not* deepen encoding. But that sentence is missing. Fix is one line in `self/` §2's named
deviations, not a mechanism change.

### 10. One of the four salience dimensions has no live source, and the formula doesn't say so
**MEDIUM.** Rule 12.

`physics/CONTRACT.md:82` keeps v0's `sal(m) = mean(novelty, relevance, emotional,
predictive)` verbatim, and `src/core/physics/index.ts:255` averages `emotional` as a plain
number. But the channel that could supply it is off by design
(`encode/CONTRACT.md:75-76`: emotion classification does not ship enabled) and the gate that
does run produces a type with no magnitude — named cleanly in `mcp/CONTRACT.md:173-183` as a
gap. So in practice `emotional` is zero for nearly everything, and the patch is
`AUTHORED_DEFAULT_CLAIM = 0.25` (`physics/CONTRACT.md:95-101`).

The brain's answer is the opposite: amygdala tagging at encoding is the *strongest* single
predictor of what consolidates — it is the module map's own one-liner for `encode/`.
Running the mean of four with one dimension structurally dark, and floor-patching the result
with a constant, is a deviation from the reference architecture that no contract names.
Naming it in `physics/` §5.1 costs a sentence and tells the next reader why the store's
strengths sit low.

---

## Part 2 — Named deviations (the system working)

These are explicit, defended, and fine. Listed so the mechanism is visible.

| Where | Deviation, named and defended |
|---|---|
| `physics/CONTRACT.md:11-16` | identity band is decay-exempt (flashbulbs do fade in humans); traces never blend; only a *used* retrieval resets the curve |
| `encode/CONTRACT.md:11-13` | the secrets gate has no biological analog — "a deliberate, non-ablatable addition" |
| `remember/CONTRACT.md:12-14` | encoding is authored, not involuntary — the module's whole thesis, with the risk ("an author can decline to write") stated |
| `recall/CONTRACT.md:12-15` | surfacing is relative to the turn's own background, not an absolute threshold |
| `associate/CONTRACT.md:11-16` | graded retrospective credit; homeostasis is structural rather than metabolic |
| `schemas/CONTRACT.md:12-15` | beliefs never blend — "interference and source confusion are the bugs, not the architecture" |
| `self/CONTRACT.md:11-17` | episodes are authored; identity doesn't decay; **transcript-derived self-reinforcement deliberately not copied — it is the rumination / illusory-truth pathway** |
| `sleep/CONTRACT.md:11-15` | boundary-time micro-sleeps instead of one nightly block; **it prunes at the floor where human forgetting is loss of access, not deletion** (and open question 1 keeps the argument alive) |
| `prospective/CONTRACT.md:10-13` | fails toward *tact* where humans fail toward forgetting — "hold debts, lose deadlines" |
| `store/CONTRACT.md:9-14` | no brain analog on purpose: exactness where the brain is reconstructive (rule 9) |
| `cli/CONTRACT.md:10-14` | humans have no console on their own memory — the deliberate improvement rules 4 and 6 promise |
| `dashboard/CONTRACT.md:11-13` | brains are not legible to their owners: "one of biology's bugs, not a feature" |
| `mcp/CONTRACT.md:12-14` | deliberate remembering is the exception, not the interface — the adapter assumes it will be used rarely |
| `claude-code/CONTRACT.md:11-14` | host limits live here, discovered at runtime, never assumed by the core (rule 5) |

Two more worth calling out as models of the thing done right: `remember/CONTRACT.md:102-116`
("**Three named costs**, since this rule buys its savings with them") and
`sleep/CONTRACT.md:268-273` (open question 1 records that v1's spec says the opposite of
this module's prune and refuses to resolve it). That is exactly the register the drifted
clauses are missing.

---

## Part 3 — Full per-module list

### `physics/`
- **[Top 1]** `:190` `w = 0.25 surfaced-unused` — exposure credit; no live caller
  (`physics/index.ts:111`, verified). Rule 12.
- **[Top 7]** `:217-225` `F_DAY_CAP_SLOW` — added from arithmetic at implementation, on a
  path with zero live firings. Rule 15.
- **[Top 10]** `:82` mean-of-four with `emotional` structurally dark. Rule 12.
- `:95-101` `AUTHORED_DEFAULT_CLAIM = 0.25` — a constant invented because *"the asks never
  say to set salience"* (`physics/index.ts:60-68`). The number is well-bounded and the
  reasoning is shown, so this is not drift on its own; it is listed because it is the patch
  over Top 10, and the cheaper fix is the ask.
- Otherwise the strongest contract in the repo: every constant marked TUNABLE/CAL, five open
  questions still genuinely open, and §5.3/§5.6 both carry "rewritten after review finding N"
  headers that say what the earlier text got wrong.

### `recall/`
- **[Top 1]** `:101` and guarantee 8 `:187` — "Ranking is not recording... trains nothing
  and deposits nothing." Over-broad; the boundary path at `:106-115` already does the right
  thing.
- **[Top 8]** `:211-215` — a field deliberately excluded from the durable surface set to
  protect carried parallel-run ratings; no retirement marker.
- `:263-312` — open question 5 is a ~50-line lab notebook inside a contract (see Top 4).
  Its content is excellent; its location is the drift.
- `:134-143` per-session gate state is still marked **PROPOSED — owner call at check-in**,
  and has been running live for two weeks. Same for `:160-163` (learned-edge type coupling).
  Rule 13 cuts both ways: a PROPOSED that shipped should be recorded as decided, or the
  marker stops meaning anything.

### `self/`
- **[Top 4]** guarantee 3 (`:166-197`) — one ~32-line paragraph carrying five incidents.
  Also guarantee 2 (`:139-164`).
- **[Top 9]** `:27-33` identity rotation — unnamed deviation from "no schedule decides who
  speaks".
- `:107-117` two **PROPOSED** drops (second-signature queue, identity index) still awaiting a
  check-in that the build has long since overtaken.
- Note the module's own best line, `:99-100`: *"If a doctrine names the only legitimate
  inputs, those inputs must be reachable by construction, not by a tool description nobody
  reads."* That test is the right one to apply to protection (Top 2) — and protection fails it.

### `sleep/`
- **[Top 8]** `:229-233` retention pinned ≥ 90 by a test for a consumer that retires at PROMOTE.
- **[Top 4]** guarantee 9/9b/9c (`:144-188`) — ~45 lines of incident narrative inside
  guarantees.
- `:100-104` + open question 1 (`:268-273`) — the floor prune deletes where v1's spec says
  fading is not deletion. **Named, flagged, unresolved** — correct handling; listed so it is
  not mistaken for a gap. It does deserve a decision before launch, since "only physics
  forgets" and "nothing bulk-wipes silently" (rule 7) are doing a lot of work together here.

### `store/`
- **[Top 5]** `:97-98` local-only released to "no silent egress" — a constitutional carve-out
  recorded in a module contract.
- **[Top 6]** guarantee 12 (`:168-170`) "the shipped default keeps none" — contradicted by
  `remember/`'s buffer.
- **[Top 4]** guarantee 14 (`:174-195`) — 22 lines about one environment variable.
- Guarantee 2's two inline *corrections* (`:116-139`) are the right pattern: the guarantee
  says what changed and why, rather than being silently rewritten.

### `remember/`
- **[Top 6]** `:107-111` and open question 5 — spans of normally-ended sessions are never
  retired.
- `:102-116` "Three named costs" — model behavior, no drift.
- Guarantee 14 (`:199-215`) is long but every clause is load-bearing (it is the
  constitution-6 door for verbatim experience); flagged only as a symptom of Top 4.

### `schemas/`
- **[Top 2]** guarantee 11 (`:135-137`) — permanent ink with no revision exit, in a system
  where every other kind names its exit.
- `:70-77` `protected.add` **PROPOSED** dropped — so protection has no live entrance while
  its doctrine still reads as law. Decide both together.
- `:78-82` belief confidence dropped in favour of strength — PROPOSED, shipped, should be
  recorded as settled.

### `associate/`
- **[Top 1]** `:13-14` and `:20` — "weak when it surfaced unused" is the exposure half.
- Open question 1 (`:103-111`) asks whether the module should exist at all and answers with
  the best argument in the repo for keeping a declared exemption visible. Left open
  deliberately — fine.

### `prospective/`
- No drift candidates. The tact deviation is named, "arrival is a cue, not a command" is
  mechanized with a test that asserts no second injection path, and `:61-62` cites a human
  rating (23 of 23) rather than an argument — rule 11 exactly as written.

### `encode/`
- No independent drift candidates. `:75-76` ("emotion classification does not ship enabled")
  is the correct, conservative call; the drift is that `physics/` never reckons its
  consequence (Top 10).
- Guarantee 6 (`:99-103`) — *"Every stated privilege is mechanized or is not stated"* — is
  the general form of the rule that Top 1 violates. The system already owns the razor.

### `adapters/mcp/`
- **[Top 1]** `:26` and guarantee 4 (`:92-93`), including the test that locks it.
- Open question 4 (`:173-183`) is a model of a named gap; nothing to fix there.

### `adapters/cli/`
- **[Top 3]** guarantee 12 (`:121-123`) "currently one item: removal" against fourteen
  dispatched commands.
- §5's Inputs list (`:74-76`) is stale in both directions: it names `on`/`off`, `protected`
  and `restore`, none of which is a command (the permanent list is printed inside `verify`,
  and by the dashboard's identity view), and omits `verify`, `note`, `recall`, `rebrief`,
  `migrate-cache`, `backfill-claims`, `repair-dates`, `repair-merged-beliefs`, `probe-oq4`,
  `doctor` and `credentials`. Rule 16: the owner's own page about the owner's own console
  does not describe it. LOW-MEDIUM, trivially fixed, worth fixing because §5 is what a
  reader trusts.
- Open question 2 (`:141-144`) — removal has never fired in production in any generation, and
  the contract says so and asks for a decision. Correct handling.

### `adapters/dashboard/`
- No drift candidates; the smallest contract in the repo and the one most obviously written
  to be read. `:35-37` ("v1's 3.1k-line panel system is not ported; views are rebuilt
  minimal-first... anything further is earned by the owner asking for it") is Amendment 15
  applied without ceremony.

### `adapters/claude-code/`
- Guarantee 18 (`:229-243`) and guarantee 15 (`:195-214`) are long but describe genuinely
  intricate host behavior; symptom of Top 4, not separate drift.
- `:75-83` primacy resolver — explicitly scaffolding, explicitly retired at PROMOTE. This is
  the marker Top 8 wants copied.
- `:92-98` model-seat pins still **PROPOSED**.

### Not covered by any contract
`src/core/counterpart.ts` (the composition root), `src/core/revision.ts` and
`src/core/retrieval.ts` have no CONTRACT.md and appear in `docs/module-map.md` only
indirectly. The reference-credit path the owner ruled on today lives at
`counterpart.ts:1327-1470` — i.e. the mechanism behind Top 1 is not inside any module's
guarantees. **MEDIUM**, rules 10 and 16. Either these are modules and owe a one-page
contract, or the map should say plainly that the root is glue and name where its rules live.

---

## What I deliberately did not list

- Contract length *as such*. Detail belongs in contracts (CLAUDE.md says so); what drifted is
  guarantees absorbing narrative, which is Top 4.
- The many `PROPOSED` markers, individually. Collectively they are worth one pass: several
  have shipped and run for weeks, and a marker that survives its own decision teaches readers
  to ignore markers. Listed under the modules that carry them.
- `CRASH_STALE_MS = 12h`, the BM25 length normalization, the cue-unit floors, the identity
  share, the `isJournal` predicate, the explicit-dir guard, `sessions.ts`. Every one of these
  was built *after* a measured failure and cites the measurement. That is rules 11 and 15
  working, and it is most of the recent work.
