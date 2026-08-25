# `adapters/claude-code/` — INTERFACE-GAPS

*Everything the composition root and this adapter needed from a module they may
not edit, plus three holes found by building them. Filed rather than hacked
around (the no-cross-edits rule); each entry says what exists today, what the
honest fix is, and where the proof lives.*

Written 2026-08-25, alongside `src/core/counterpart.ts`, `test/counterpart.test.ts`
and `test/claude-code.test.ts`.

---

## 1. `remember/`'s `ProposalSource` has no member for a swept proposal

**What exists.** `ProposalSource = "session-end" | "jot"`. Both mean "the
experiencer wrote this". A crash-fallback sweep is neither, and
`Counterpart.applySweep` must build a `Proposal` to reach `mintProposal` — so it
sets `source: "session-end"` (`SWEPT_SOURCE`, named and commented at the top of
`counterpart.ts`) and carries the truth in `MintOptions.channel: "fallback"`.

**Why it is not urgent.** Nothing downstream reads `proposal.source`:
`mintProposal` reads content, kind, salience, updates, aliases, feeling, title
and day, and takes the authorship record from `channel`, which is engine-set and
unclaimable (SEAMS N). `test/seams.test.ts` already mints with
`channel: "fallback"` from a `source: "session-end"` proposal, so the composition
root is doing exactly what the seam suite does.

**The honest fix.** Add `"fallback"` to `ProposalSource` and let the fallback
path say what it is. One-line union change in `remember/proposals.ts`, plus the
places that switch on it (none today).

## 2. `Store.open({ dir })` does not run its own path guard — FOUND LIVE

**What happened.** `dataDir()` calls `assertSafeDataDir()`, so the
environment-resolved path is guarded. An EXPLICIT `dir` goes straight into the
constructor, which `mkdirSync`s `prose/`, `versions/`, `tmp/` and `cache/` before
anything checks it. Writing `test/counterpart.test.ts` created a directory under
`~/.bansai` — v1's live memory — proving the guard by violating it.

**What was done.** `Counterpart`'s constructor now calls
`assertSafeDataDir(opts.dir)` before anything opens, and
`test/counterpart.test.ts` — "an explicit data dir aimed at v1's live store is
refused BEFORE anything is created" — asserts the refusal AND that nothing was
created on the way to it.

**Why that is not enough.** The root is one entrance. `Store.open({ dir })` is
public and every adapter, tool and test can reach it directly. Scar §2.13 is
"path guards resolve before they compare, and no tool silently accepts a pointer
at real data" — the guard exists and resolves correctly; the gap is that the
entrance a caller actually uses does not consult it.

**The honest fix.** One line at the top of `Store`'s constructor:
`this.dir = assertSafeDataDir(opts.dir ?? dataDir())`. `assertSafeDataDir`
already resolves both sides before comparing, so `~/.bansai/../.bansai/x` is
caught too; the root's call then becomes redundant belt-and-braces rather than
the only belt.

**Residue for the owner:** the stray directory this found — `~/.bansai/x`,
containing an empty v2-shaped layout — could not be removed from this session
(the sandbox refuses writes under `~/.bansai`, correctly). Nothing of v1's was
modified: `x` is a new sibling directory, and every pre-existing entry is
untouched. It needs one `rm -rf ~/.bansai/x` from the owner.

## 3. `self.appendChapter` has no gate — FOUND BY THE CALLER-UNIVERSALITY TEST

**What happened.** `SelfOptions.gate` is consulted by `ingestEpisode` and by
nothing else. `appendChapter` writes the chapter straight into the episode's
canonical prose. So a credential written into a chapter landed in
`prose/episodes/*.md` and stayed there — while the memory minted from that same
episode was correctly redacted. Scar §2.7 is "a gate covers every ingestion path
**and every side-channel**", and the journal is the side channel.

**What was done.** `Counterpart.appendEpisode` routes the chapter through the
same `bridge.episodeGate()` and appends the GATE's text, refusing outright when
the battery refuses. Proof: `test/claude-code.test.ts` — "the entrances are
enumerated, and each one refuses or redacts a credential" walks all four
ingestion entrances and then asserts no canonical byte anywhere under `prose/`
holds the secret.

**The honest fix.** `self/` should consult its injected gate in `appendChapter`
the way it does in `ingestEpisode`, so the next caller inherits the rule instead
of having to remember it — the same reasoning that put the observer stand-down at
the store seam rather than at entry points.

## 4. SEAMS queued item 12 is now ANSWERABLE, and is answered here

**The item.** "Once entrances exist (adapters), enumerate every ingestion
entrance and prove the gate battery covers each (encode's caller-side half)."

**The entrances this build creates**, all four through `Counterpart`:

| entrance | gate | wired at |
|---|---|---|
| `submitSessionEnd` | `bridge.batteryGate()` (per proposal) | `counterpart.ts` `deposit()` |
| `submitJot` | `bridge.batteryGate()` (per proposal) | `counterpart.ts` `deposit()` |
| `appendEpisode` + `ingestEpisode` | `bridge.episodeGate()` | `counterpart.ts`, and `Self`'s `gate` option |
| `sweepFallback` → apply | `bridge.gateSweepChunk()` (CHUNK level) | `counterpart.ts` `applySweep()` |

**Not yet covered, and named so it is not mistaken for covered:** anything an
adapter other than this one adds. `mcp/`, `cli/` and `dashboard/` do not exist
yet; when they do, the table above is the thing to extend, and the totality test
in `test/claude-code.test.ts` is the shape to copy.

## 5. `kind` defaults in two places (SEAMS queued item 9, still open)

`remember/proposals.ts` defaults a kindless draft to `"fact"` for the authored
door. The fallback door reaches `encode/` through `gateSweepChunk`, which needs a
`kind` on every proposal, so `counterpart.ts` spells the same default
(`DEFAULT_KIND`). Two spellings of one rule. The fix queued item 9 already
names — move the default behind the gate verdict — closes both.

## 7. The authorship ask has no RETURN CHANNEL in this host's hooks

**What exists.** `stop()` raises `AUTHORSHIP_ASK` whenever the scope holds spans
no proposal has covered, measured (not assumed) from
`SpanBuffer.coverageReport`. The entry script prints it into the model's context.
`Counterpart.submitSessionEnd` is the entrance that turns a written dump into a
memory, and it is fully wired and tested.

**The gap.** A hook can only put text INTO the context; it cannot receive the
model's answer. So the ask goes out and the deposit has nowhere to come back
through — in this host, that channel is a TOOL, which is `mcp/CONTRACT.md`'s
job (note, recall, status). Until the MCP adapter exists, the authored front door
is reachable only by a caller holding the `Counterpart` directly, and the crash
fallback carries the load the dump was meant to carry.

**Why the ask ships anyway.** Every session-ending path must raise an ask (spec
§2 G5/G11's mechanized half), and an ask that exists before its return channel is
the right order: the alternative is a channel nobody is ever invited to use. The
telemetry says which happened — `adapter.authorship.ask` records `uncovered`
every time, so the day the channel lands, the backlog it inherits is already a
measured number.

## 6. `sleep/`'s `SleepStore` and `Store` agree structurally, undocumented

`runCycle({ store })` accepts the real `Store` directly (this build passes it
without a wrapper); `test/seams.test.ts` wraps it in an explicit adapter object.
Both work, which means the structural compatibility is load-bearing and nothing
asserts it. A one-line `const _: SleepStore = store` type test in `sleep/`'s
suite would keep a future signature change from silently forcing every caller
into the wrapper.

---

## Host-side gaps — this adapter's own open questions (CONTRACT §7)

1. **Is there a jot channel in this host?** `Counterpart.captureJot` and
   `submitJot` exist and are tested; no hook calls them, because the host offers
   no in-the-moment deposit surface this adapter can see. The MCP adapter is the
   likely home (`mcp/CONTRACT.md`: note, recall, status). Cost to the turn:
   unmeasured.
2. **The orphanable tail is measured, not bounded by anything host-specific.**
   `noteOrphanTail` runs on `session-end` and `pre-compact`, and its bound is
   `self/`'s re-ask thresholds — a memory number, not a host one. The host-local
   number (how long after the last session-ending event a session can keep
   living) is still unknown.
3. **Which host event means "crashed"?** Still open, and the reason the fallback
   runs on eligibility (`endedSessions` ∧ uncovered spans) rather than on a
   crash signal. `pre-compact` is the closest thing to a named catastrophe and it
   is wired; an abrupt exit is indistinguishable from an ordinary one.
4. **Long-call survival is asserted, not proven in this host (CONTRACT §5 G6).**
   The call streams (scar E3) and `socketLifetimeMs` is a reported capability
   with no reporter. The proof G6 asks for — one long call surviving this host's
   ceilings, in this host — needs a live run with a real credential, which no
   test here is entitled to make.
5. **`executionCeilingMs` has no consumer.** It is reported and checkable; no
   code compares against it yet, because every foreground path is an appender and
   the heavy work is already detached. When something in the foreground can grow,
   this is the number it must be measured against.
