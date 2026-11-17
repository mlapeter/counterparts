# `adapters/codex/` — what the build learned

## 2026-11-09 — CX2, the first build

- **Shapes copied from the probe, not the docs.** The 11-09 probe (CX1 §0b, a temp `CODEX_HOME`, Codex 0.167,
  `gpt-6.1-sol`) gave the rollout's record kinds and the provenance metadata the reader classifies by:
  `content_item_metadata[].provenance` is `{type: "user"}` for typed text, `{type: "harness", hook: true}` for a
  hook's context (developer role) or a Stop hook's reason coming home (user role, `<hook_prompt …>`), and
  `{type: "harness", hook: false}` for Codex's own blocks. Classifying by provenance, not by text, keeps the reader
  out of the frame-matching Claude Code's reader needed.
- **`session_meta.model` is null** on 0.167; `turn_context.model` and the hook payload's `model` carry it. CX1 §1's
  table implied the session meta would.
- **`originator`** reads `codex-tui` for the TUI and `codex_exec` for `codex exec`, so `exec` is the unattended
  session (no person to read a line).
- **Trust is positional**: `[hooks.state."<hooks.json>:<event_snake>:<group>:<handler>"] trusted_hash = …`. Hence
  "append last, update in place, remove only ours", and a disconnect that warns when a group sat after ours.
- **Codex's `additionalContextLimit` is in tokens** (codex-rs `protocol/src/hooks.rs`: "Unset uses 2,500 tokens;
  `0` disables spilling"), and is part of the trust hash, so changing it re-asks the person.
- **Stdout that looks like JSON and does not parse fails the hook** (codex-rs `hooks/src/events/common.rs`): the
  envelope prints one whole object or nothing, never a mix.
- **The plugin names itself "Claude Code"** at `initialize` (codex-plugin-cc `scripts/lib/app-server.mjs`,
  `DEFAULT_CLIENT_INFO`) and spawns `codex app-server` with `env: process.env`: hence the two stand-down signals.
  The TUI's managed daemon may not carry a spawning shell's environment, which is why the originator is the
  fallback; a daemon started from a shell inside Claude Code would stand every later session down (unmeasured).
- **The library/entry split.** The adapter (then `adapter.ts`) imports only shared leaves; `bin/hook.ts` borrows Claude
  Code's config, scope and session-scope readers and its embedder, as `mcp/bin/serve.ts` already borrows Claude
  Code's doctor. Copying those readers would have been two rules for "which file, which directory".
- **Hermetic tests run the entry in-process** (`runCodexHook`, with an injected spawner so no real worker runs over a
  temp store) and once as a real process (SessionStart, which starts no worker).

## 2026-11-17 — one file, on purpose

- **The modules folded into `bin/hook.ts`.** CX2 took the plugin bundle past its margins: core 498 of 490, the
  directory flavor 520, over the directory's hard 512. Its ten new traced files were `core/reader-note.ts` (a leaf
  the core reads), `cli/codex.ts` and eight here. So `adapter.ts`, `words.ts`, `transcript.ts`, `envelope.ts`,
  `index.ts`, `wire.ts` and `doctor.ts` are sections of `bin/hook.ts`, above the entry's, each headed with the file
  it was; `cli/codex.ts` is the Codex section at the end of `cli/wire.ts`, beside the other host's connect. Core is
  490 and the directory 512 after it. Same exports, same behaviour; the hook's path, and so its command in
  `hooks.json` and `CODEX_HOOK_MARK`, did not move. The precedent is `mcp/NOTES.md`, "No new files, on purpose".
- **The library/entry split survives inside the file**: the only other adapter imported is Claude Code's (its
  config, scope and session readers and its embedder), and the test reads that none of those names appears above
  the entry section. The CLI now imports the hook's file for the TOML edits and doctor's lines; importing it starts
  nothing (`start()` runs only when the file is the process's entry).

