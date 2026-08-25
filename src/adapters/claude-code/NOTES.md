# `adapters/claude-code/` — NOTES

*Implementation choices the CONTRACT left open, and the reasoning behind them.
Gaps and obligations live in `INTERFACE-GAPS.md`; this file is the "why it looks
like this" record.*

## 1. One entry script, not five

`bin/hook.ts` dispatches on the host's `hook_event_name` rather than shipping a
script per hook. Host hook names, wiring and settings-file mechanics are
advisory (CONTRACT §5 G9), and one executable means one place where the payload
is parsed, one place that always exits 0, and one place that closes the store.
`HOOKS` and `SESSION_ENDING` are the enumerations a test walks; the dispatch is
`ClaudeCodeAdapter.hook()`, which is total over `HookName` by the compiler.

Suggested wiring (host trivia, not a contract):

```json
{ "hooks": { "SessionStart": [{ "hooks": [{ "type": "command",
  "command": "~/.bun/bin/bun run <repo>/src/adapters/claude-code/bin/hook.ts" }] }] } }
```

…and the same command for `UserPromptSubmit`, `Stop`, `SessionEnd`, `PreCompact`.

## 2. The pure/impure split in `spawn.ts`

`planSpawn` is pure and returns a checkable `SpawnPlan`; `spawnDetached` is the
six lines that start a process. Everything worth asserting — the watchdog
validated against `remember/`'s staleness window, the credential precondition,
the environment assembled with `COUNTERPARTS_DATA_DIR` written LAST, the observer
refusal, the escalation counter — is in the pure half, so the tests prove the
properties without ever forking. `Spawner` is injected for the same reason.

## 3. Why the adapter holds a `Counterpart` rather than the modules

Every hook needs two or three modules at once (recall needs schemas, prospective
and associate; the boundary needs spans and self). Assembling them here would be
a second composition root, and the one thing SEAMS exists to prevent is a caller
who forgets a channel and silently loses the safety half riding with it. The
adapter takes the assembled brain and adds nothing but host translation.

## 4. Delivery telemetry rides on the NEXT hook

`sessionStart` records the sentinel it rendered; `userPromptSubmit` reports the
last line the host actually placed in context. That ordering is forced: nothing
inside the session-start hook can know what the host did with its return value.
It is also exactly scar §2.3's shape — v1 shipped eleven days of truncated wakes
because only the render was instrumented — so the two records are deliberately
separate events (`adapter.wake.injected` vs `adapter.wake.delivered`), not one
event with a flag.

## 5. The anti-loop guard is per (hook, session), in process

A hook's own injection lands in the transcript, and a host that re-fires on
injected text would recall on its own render forever. The guard is a set of
`hook:sessionId` keys held for the duration of the call — in-process on purpose,
because the failure it prevents is re-entrancy within one hook invocation, not a
race between two processes. Recall has its own, stronger protection at the cue
layer (`STRIPPERS`' `counterparts-injection` entry), so this is the second of two
independent defences rather than the only one.

## 6. `substanceOf` is one function on purpose

Spec §2 G10 (conversational text only) and §2 G11 (injected context is kept in
capture, excluded from pacing) are two halves of one decision about the same turn
list. They are computed a few lines apart, from the same input, so they cannot
drift: `captureSpans` receives every turn and lets `remember/`'s `enters()` drop
the blind spot; `substanceOf` counts only `source === "conversation"`.

## 7. The interpreter prompt asks for `remember/`'s vocabulary and trusts none of it

`SYSTEM_PROMPT` names exactly the fields `ProposalDraft` accepts. That is a
convenience for the model, not a security boundary: `intake()` re-validates every
field, unknown keys are dropped and counted, and a privileged operation has
nowhere to live because `Proposal` has no field for one (§4.1 G7). The prompt
could be wrong or ignored and nothing downstream would weaken.

## 8. Why the response is parsed rather than schema-pinned

Structured outputs (`output_config.format`) would pin the shape server-side and
is the better answer. It is not used here because this build cannot exercise the
live endpoint — every test fakes `fetch` — and shipping an unverified request
shape into the one network call in the package would be exactly the kind of
"verified merged, not verified live" claim the constitution's line 11 rejects.
What ships instead is a string/escape-aware scanner (`extractJson`) that never
slices between the first brace and the last (scar §2.14), with `intake()` as the
validator. Pinning the shape is a follow-up for the first session with a real
credential; `InterpretClientOptions` is where the knob would go.

## 9. The model seat: one knob, pinned, and a placeholder that expires

`DEFAULT_INTERPRET_MODEL` is a pinned identifier held in configuration, and there
is exactly one seat because there is exactly one model call in the package. The
`placeholder` / `expires` machinery exists anyway, unused by the default, because
scar §2.15's third clause is about the shape of the config rather than about
today's value: an undecided default must be able to expire, or "never decided"
becomes "decided" by silence. `seatStatus` refuses a placeholder with no expiry
outright, which is the case v1 actually shipped.

## 10. `readTranscript` tags the blind spot rather than dropping it

Tool results, images and documents come back as zero-length turns tagged `tool` /
`image` / `file`, and `remember/`'s `enters()` is what drops them. One rule, one
place. The alternative — filtering here — would put a second copy of the
conversational-text-only rule in a file that changes with the host.
