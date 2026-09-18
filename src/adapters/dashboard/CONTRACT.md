# `dashboard/` — CONTRACT

## 1. Purpose

The owner's window: what was remembered, what faded, what changed and why — visually, at a
glance. The direct instrument of constitution line 16, and the owner's tool for judging
Counterparts against v1 during the parallel run.

## 2. Brain analog

None — this is deliberately outside the analogy (constitution line 12 deviation, named):
brains are not legible to their owners, and that is one of biology's bugs, not a feature.
Legibility is the product's answer to the trust question a brain never has to face.

## 3. Keeps

- **Render-time id resolution.** [v1] Logs and records carry ids; the dashboard resolves
  them to text at render time — an erased or superseded memory stops resolving immediately,
  where baked-in text would outlive it (v1 DECISIONS, dashboard batch; scar §2.20 kin).
- **The totality test.** [v1] Every axis the registry knows is displayed or explicitly
  marked absent — a silent missing panel reads as "nothing happening," which is how v1's
  curation starvation hid (scar §2.17; v1's six-axis totality test, generalized).
- **Narration in the system's own voice.** [v1] The brain-voice framing (what the system
  did, first person, plain sentences) earned its keep as the owner's fastest read.
- **The revision story view.** [new, from review finding 1] The challenge-pressure log
  (§5.6: lived day, challenger, contributed force) rendered as a watchable narrative per
  contested belief — the ledger's explainability, restored visually.
- **Identity-band and protected lists, enumerable on demand.** [review finding 2]
  Permanence and inspectability scale together (scar §2.19).
- **Prose views the owner can open.** The dashboard links every memory to its markdown
  file — the owner reads the store itself, not only renderings of it (constitution line 6).

## 4. Drops / simplifies

- v1's 3.1k-line panel system is not ported; views are rebuilt minimal-first
  (Amendment 15): status, memory browser, revision stories, band/protected lists,
  activity feed. Anything further is earned by the owner asking for it.

## 5. Contract

**Inputs** — the canonical stores (read-only), the event log, the registry of kinds/bands,
the written self page and its versions (2026-09-18; shown as a list with bodies, newest
first — there is no precedent here for a text diff between two revisions, and a page is
prose a person reads rather than a field that changed).
**Outputs** — rendered views only. **Guarantees:** **[M]** the dashboard runs in observer
mode by construction (`docs/observer-mode.md`): it strengthens nothing, deposits nothing,
resolves no references, and a test asserts its process holds no write handle to any
canonical store. **[M]** Render-time id resolution everywhere; no memory body text is
persisted into dashboard state. **[M]** Totality: every registered axis appears or is
marked absent. **[A]** Views stay readable by a non-engineer — the owner is the acceptance
test.

## 6. Scars honored

**E7** (observer read-only both directions) · **§2.4** (absence is displayed, not silent) ·
**§2.17** (starved paths become visible) · **§2.19** (inspectability scales with
permanence) · **§2.20** (ids in state, text at render).

## 7. Open questions

1. Terminal-first (v1's shape) or local web view? Owner's call at build time — the
   contract is identical either way.
2. Build staging: minimal brain-view ships DURING the parallel run (owner ruling
   2026-08-25) — which views are in that minimum beyond status + revision stories?
