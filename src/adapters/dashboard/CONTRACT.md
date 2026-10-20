# `dashboard/` — CONTRACT

*This contract guides the work; it doesn't limit it. Anything here, RESOLVED items included, can be raised for discussion at any time and revised when there's a better way (constitution line 13).*

## 1. Purpose

The owner's window: what was remembered, what faded, what changed and why — visually, at a
glance. The direct instrument of constitution line 16. Since 2026-09-25 it is also meant to
be the owner's main command center: most people will use the terminal once, to install,
and manage their memory here by clicking (the owner's own preference too).

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
- **The record, named.** The owner reads the store itself, not only renderings of it
  (constitution line 6), so an opened memory says which record it is: id, revision and
  content hash. For now that is what it prints; until 2026-09-18 it printed the markdown
  file's path instead, which named a filesystem layout rather than the memory, and which
  the bodies-in-rows work takes away.
- **The dream journal, and what crossed into the core.** [new, 2026-09-26] Each dream
  with its journal and every change it made (the memories it touched, clickable; an undone
  change struck through), and the core's recent history — the crossings with their lane,
  the owner's demotions with his reason, a dream's nominations. A dream is shown as a
  dream: its journal is read from the `dreams` table and never presented as a memory.

## 4. Drops / simplifies

- v1's 3.1k-line panel system is not ported; views are rebuilt minimal-first
  (Amendment 15): status, memory browser, revision stories, band/protected lists,
  activity feed. Anything further is earned by the owner asking for it.

## 5. Contract

**Inputs** — the canonical stores (read-only), the event log, the registry of kinds/bands,
the written self page and its versions (2026-09-18; since 2026-09-25 shown as a timeline,
each version with what changed from the one before it).
**Outputs** — rendered views, and the owner's management actions. **Guarantees:** **[M]**
LOOKING is observer mode by construction (`docs/observer-mode.md`): every view strengthens
nothing, deposits nothing, resolves no references, and a test asserts the adapter's own
code holds no write handle to any canonical store. **[A]** MANAGING is the owner's own act
and is not artificially limited: an action the CLI offers (note, remove, about, backup, export,
scope, rebrief, …) may be offered here, run through the CLI's own door — the same code and
the same checks — never through the observer source; a destructive one asks the owner to
confirm. For now `install`, `uninstall` and `start-fresh` stay terminal-only. A known limit, not solved here: the page and its action token are served to anything that can reach the loopback port, so on a machine shared with other OS users another local user could manage this memory, not only read it. **[M]** Render-time id resolution everywhere; no memory body text is
persisted into dashboard state. **[M]** Totality: every registered axis appears or is
marked absent. **[A]** Views stay readable by a non-engineer — the owner is the acceptance
test.

**Which store it serves (2026-10-12).** Two stores on one machine (a throwaway trial store
and the person's real one) can both try port 4747, so a reader must be able to tell whose
dashboard answered. **[M]** `GET /api/whoami` returns `{ store, version }`: `store` is the
store id (`adapters/store-id.ts#storeId`), `st_` and 16 lowercase hex of a sha256 over the
store's secret per-store salt (G58's `sessions/expansions.salt`) and its resolved,
symlink-free data dir (`/^st_[0-9a-f]{16}$/`), so a guessed path cannot be confirmed from
it; `version` is `package.json#version`, or null when unreadable. `/api/onboarding` carries
the same `store` field. The dashboard only reads the salt (E7): `store` is null until a
session-start wake has minted it. The id is stable across opens, differs between stores,
and never carries the path; a store moved to another path reads as another store.
**[M]** The session-start wake of a Claude Code hook carries the same id: since 2026-10-20 as
the `store=st_…` field of the wake's head tag (`<!-- counterparts:wake meet=… store=st_…
elements=… bytes=… -->`, or `<!-- counterparts:session … -->` before a wake with no head tag;
`adapters/store-id.ts#ONE_TAG`), before that as `<!-- counterparts:store id=st_… -->` beside
the onboarding marker. The sidebar mod reads every form, compares the
two and trusts a dashboard only when they match. Nothing about which port is chosen changed.

## 6. Scars honored

**E7** (observer read-only both directions) · **§2.4** (absence is displayed, not silent) ·
**§2.17** (starved paths become visible) · **§2.19** (inspectability scales with
permanence) · **§2.20** (ids in state, text at render).

## 7. Open questions

1. Terminal-first (v1's shape) or local web view? Owner's call at build time — the
   contract is identical either way.
2. Build staging: minimal brain-view ships DURING the parallel run (owner ruling
   2026-08-25) — which views are in that minimum beyond status + revision stories?
