# `fit/` — NOTES

What the build learned. Newest last.

## §1. Build B (2026-09-28)

- **Measured as it leaves.** A tool result is the payload's JSON, pretty-printed, with the
  bundle text escaped inside it once more — so a character of bundle can cost two on the wire.
  Parts are measured that way (`dreamResultChars`, reflect's `resultChars`), not by the
  bundle's own length.
- **Stateless carry-over where it can be.** The dream's queue is read from the dreams' own
  `shown` column — no queue table. The ledger holds only what cannot be re-derived: which
  fidelity each id was shown at, the later parts' keys, and how far into each episode the last
  dream read.
- **No new durable event names.** The fit report rides on `dream.begun`, the reflection's row
  (`detail.fit`), and the `mcp.recall` row (`fromIndex`). A new name would need every
  dashboard registry to learn it; that is a dashboard change for its own session.
- **Unsure:** the chapter-entry importance is a keyword heuristic (feeling words, the owner
  named, words of a turn). A model-written label per entry would be better when one exists.
- **Unsure:** `NIGHT_CHARS` 100,000 and the reflection's `ROOM_CHARS` 80,000 are sized by
  feel from the first dream's ~111k tokens. The lookup count and a real night's `dream.begun`
  row are what should size them.

## §2. After the adversarial review (2026-09-28)

- **Characters are not tokens.** The ceilings are in tokens; a CJK character is about a token by
  itself. Every room and part now costs text by `wireChars` (a non-ASCII character counts as
  three), and cuts go by `clipWire`. Tested with Chinese text at the real limits.
- **A result carries its payload twice** (the text, and `structuredContent`). Whether a host
  counts both is not known here; nothing in this package reads `structuredContent`, so the long
  `bundle` text rides only in the text and the structured copy says `bundleChars`. (Superseded
  2026-09-29: Claude Code hands the model `structuredContent` and drops the text, so the whole
  payload rides in both — `mcp/server.ts#result`.)
- **A lookup counts as the index's only while its run is open** (the dream not journaled, the
  reflection not finished) or within `LOOKUP_GRACE_MS` of its end.
- **Journal entries the room did not take are carried**: the index keeps each episode's entry
  count and the entries below it that were not taken (`unread`); the next dream sends them
  whether or not the episode grew.


## §3. The host's ceiling, measured (2026-10-02)

- **What Claude Code does past it.** Read from Claude Code 2.1.287's own code: a tool result
  whose text passes 50,000 characters (the global persist threshold; an MCP tool's own is
  100,000, and the lower wins) is saved to a file and the model gets a 2 KB preview; an MCP
  result past 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`, counted for real once the estimate passes
  ~12,500) is saved the same way. The text it measures is `structuredContent` serialized
  compact. The headless nightly run cannot open the file, so the dream of 10-02 read part 3 of
  its bundle only (the begin, 51.5 KB, and part 2, 51,306 characters, were saved), and the
  reflection lost its begin (51.7 KB). The night of 10-01 lost the same three (51.4 KB, 52,066,
  51.9 KB).
- **Two characters a token, not three.** Part 2 tripped the TOKEN line at 51,306 characters:
  the bundle is JSON escaped inside JSON, every quote a backslash too. 54,000 was sized at three.
- **One ceiling.** `TOOL_RESULT_CEILING.CHARS` = 40,000 — 20% under both lines at that density —
  and the dream's and the reflection's rooms derive from it; so does the nightly writer's day
  (`self/writer.ts#fitNightWriter`, which shrinks the day until its block fits beside the page).
  The env var could raise the token line; nothing raises the 50,000, so the fix is the caps.
- **New durable event names after all** (§1 said none): `mcp.part` and `mcp.result.oversize`.
  The lookup count measures what a receiver fetched by id, which cannot see a part the host
  never showed; these two say what was handed and what was cut. Every dashboard registry
  learned them in the same change.
- **Unsure:** carrying the bundle as structured fields rather than a JSON string inside JSON
  would roughly halve its characters for the same content. Not done here.
