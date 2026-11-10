# `adapters/codex/` — CONTRACT

*Added 2026-11-09 (CX2), from the CX1 spec (`~/counterparts-notes/2026-11-09-briefs/CX1-codex-spec.md`)
and Mike's rulings of the same day. Working defaults, held lightly.*

## 1. Purpose

OpenAI's Codex as a host of the same memory: its hooks drive the host lifecycle (`../lifecycle.ts`) as
Claude Code's do, and its MCP server is the same server, launched `--host codex`. **Codex's model is not the
counterpart** (Mike, 11-09, CX1 §4 option 2): it reads the counterpart's memory as a shared record and writes as
itself. Claude still runs the night; Codex runs none.

## 2. Brain analog

None of its own: another pair of eyes and hands on the same memory — a colleague reading the diary and adding
notes signed with their own name.

## 3. Keeps (lineage: `claude-code/`, the hosts plan #292/#294)

- The lifecycle seam whole: the wake's composition, recall per turn, the boundary (capture through the per-session
  cursor), the ask's pacer, the registry (records carry `host: codex` and the model), the detached worker.
- Claude Code's config, scope and session-scope rules, borrowed by the entry point (`bin/hook.ts`) unchanged, so
  which file and which directory is one rule on every host; its embedder, the same way.
- The Stop ask's two lines, reworded for the model's own voice (`words.ts#codexStopAsk`).

## 4. Drops / simplifies

- **The night**: no dream offer, start, catch-up, held line or morning share.
- **Claude Code's person-facing lines**: the first meeting, the first-launch scope question, plain reminders, the
  update and maintenance lines, the write-up pointer, the Code tab line. Each is claimed once; they wait for Claude
  Code (INTERFACE-GAPS §2).
- **The wake-arrival check** (Claude Code reads its own transcript's attachment): not ported (INTERFACE-GAPS §3).
- **PreCompact**: not wired (optional in CX1 §5).

## 5. Contract

**Inputs** — Codex's hook payload on stdin (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`;
`prompt`, `source`, `stop_hook_active`, `turn_id` per event) and the rollout `.jsonl` it names.

**Outputs** — one JSON object or nothing (`envelope.ts`): `hookSpecificOutput.additionalContext` at SessionStart
and UserPromptSubmit, `{"decision":"block","reason":…}` at Stop; appended spans; the worker spawn.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] No adapter is imported by this directory's library files**; only `bin/hook.ts`, an entry point, borrows
   Claude Code's readers (`test/codex.test.ts`, "a sibling, not a fork"). The core imports nothing from here.
2. **[M] No hook ever fails the host**: every event is wrapped (`adapter.ts#guard`), the entry exits 0.
3. **[M] Stop captures every turn through the per-session cursor**; SessionEnd is a final boundary that tolerates an
   empty session (no transcript, or no turns).
4. **[M] Our own ask never enters capture**: it comes home as a user-role `<hook_prompt>` with hook provenance and is
   `ritual`; another tool's Stop prompt is `plumbing`; developer-role context (our wake and recall) is no turn.
5. **[M] The wake opens with the reader frame** (`words.ts#codexFrame`), outside the wake block.
6. **[M] A Codex started from inside Claude Code does nothing** (CX1 §6): no wake, recall or capture, one stderr
   line and one process-log line. Signals: the environment (`CODEX_COMPANION_*`, Claude Code's markers), then the
   rollout's `originator` ("Claude Code"). **[A]** neither is measured yet: `tools/codex-standdown-probe.sh`.
7. **[M] `connect --host codex` appends ours after every other tool's hooks and never moves theirs**; disconnect
   removes only ours and their `hooks.state` rows. Trust is the person's: nothing here writes a `trusted_hash`.
8. **[M] The MCP server launched `--host codex` refuses `self_page` writes, `dream`, `reflect` and `meet`**, tags
   every write with the host (meta) and model (column), and keeps a `me` as the model's own note and an `us` as its own
   note about itself and the owner (option B, 2026-11-10; `core/reader-note.ts`), never identity material.

## 6. Scars honored

§2.13 (the data dir travels explicitly: in the MCP entry's `env`, and the worker's pin), §2.18 (the context limit
is written, not assumed: `TUNABLES.CODEX_CONTEXT_LIMIT_TOKENS`), §2.4 (a stand-down says so).

## 7. Open questions

INTERFACE-GAPS.md.
