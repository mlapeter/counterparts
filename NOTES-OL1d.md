# NOTES-OL1d — dreaming off, host-aware (brief: ~/counterparts-notes/2026-10-26-briefs/OL1d-dreaming-off-host-aware.md)

## Done
- Orientation. Branch fix/dreaming-off-host-aware from origin/master 77563bb9.

## Plan / next
1. `src/adapters/mcp/server-self-tools.ts` dream `launch`: refuse `dreaming-off` while `dreams.setting() === "off"` (every host).
   Do NOT gate `begin`/`writer`: the Claude Code headless night composes its prompt from the store (night-run.ts:750),
   never calls MCP launch, and a run under way must finish (owner decision D) — gating begin would break that.
2. `setting` said text per host (server.host): Claude Code byte-identical; claude.ai + Desktop own words.
3. Desktop dream/reflect description (DESKTOP_TOOLS in tools.ts) + launch `how` without "background agent".
4. trial.sh NIGHT_PROMPT: if launch refuses, report its reason and stop.
5. Tests (new test/dreaming-off-hosts.test.ts): off refuses launch on each host via tools / HTTP door; auto on claude-ai
   wake plans only the worker (spawner capture); words per host; Claude Code byte-identical.

## Learned
- Nothing in mcp/ or remote/ starts a night: only claude-code/hooks.ts#startNightRun (+ CLI catch-up). Hookless wake
  leaves headless offers unclaimed (server.ts#wakeDreamLine) and claude.ai wake has no dream line at all.
- #644 originally set hosted stores to `off` to stop a night starting on its own, relying on launch NOT being gated by
  off; it has since moved to `auto` (e34b3a50), so this change doesn't break it.
- Reflect: under off Claude Code's whole night (writer+dream+reflection) doesn't start. Recommendation: standalone reflect
  `launch` on the person's word stays available (awake, not a dream); the night's reflection stops with the launch. FLAG.
- claude.ai `ask` behaves like `auto` (no dream line there). FLAG, no new value.
