# `dream/` — INTERFACE-GAPS

What this module still owes, or asks of others (2026-09-26).

1. **Live try-out with a real background agent.** The flow was exercised against a demo
   store through the MCP server (launch → begin → propose → journal, then
   `counterparts dream --show/--undo`); a real Claude Code session launching the Agent
   tool with the prompt has not yet been watched end to end on the owner's machine.
   *(CLOSED 2026-09-29, noted 2026-10-09: on the owner's machine that day a session's
   launch went through once he said yes, after the host's classifier had refused the
   unasked one (NOTES 2026-09-29). Since then `auto` runs headless (#282,
   `night-run.ts`), and the dream and the reflection have run on his machine night after
   night: IMPROVEMENTS U14 records the nights of 10-02 to 10-07.)*
2. **The ask is claimed when composed**, not at delivery. If the host drops the line
   (envelope limits), that day's ask is lost. The plain reminders' pattern
   (`bin/hook.ts#deliverTurn` → claim only what the envelope carries) is the fix.
   *(CLOSED 2026-09-29 by #282 (`401fc31`), noted 2026-10-09: `Dreams.offer` composes
   without claiming, and the host claims the day (`claimOffer`) only once the envelope
   carries the person's line; otherwise the next prompt offers it again.)*
3. **A subagent's own turns (the sidechain).** On current hosts a subagent's transcript
   is a separate file the boundary does not read; if a host ever writes a dreamer's
   turns into the parent's file, only turns carrying the mark are refused. The
   dreamer's final message is the marked hand-back by instruction and by the tool
   handing it the words.
4. **There is no door to remove one dream's journal** short of undoing it (which keeps
   it, marked undone). The owner's removal of a MEMORY blanks its address in
   `dream_changes`. *(The other half of this item — `export --markdown` did not carry the
   `dreams` table — is CLOSED 2026-10-09: one file per dream under `dreams/`, its journal
   and its changes; one resting on a confidential memory is left out unless
   `--include-confidential`, and counted. `cli/NOTES.md`.)*
5. **Merged memories keep no embedding** until the next backfill embeds them (as any new
   memory).
6. **Dream links are ordinary edges.** If the association work wants them marked (a
   table, a starting weight, a hop rule), `apply`'s `link` and `gist` arms are the two
   writers.

7. **Reflection (2026-09-27) — what it still owes.**
   - **The owner's reply to a share is not weighed** (the brief's follow-up): `told`
     records the telling; nothing reads his answer yet.
   - **No opt-out** for the morning share (on by default; Mike: opt out later if needed).
   - **A reflection on its own has no trigger**: `reflect launch` exists, but nothing asks
     for one on a dreamless day. The old SessionStart page writer still covers those
     nights.
   - **Not yet watched live** with a real background agent. *(CLOSED with §1: the nightly
     run's reflection has run on the owner's machine night after night, and on 10-07 it
     rewrote the self page and its morning share reported the cut bundles (IMPROVEMENTS
     U14).)*
   - ~~**`export --markdown` does not carry the `reflections` table**~~ — CLOSED
     2026-10-09: one file per reflection under `reflections/`, with its morning share and
     what became of it (as §4 for dreams).
   - **The crash-fallback sweep sets no about mark**: a self memory it mints is unmarked,
     so not a core candidate until something awake marks it. A choice, not an oversight —
     the sweep is a reteller.

8. **The dashboard reads the ask's preview (2026-09-27).** `previewAsk` exists for the
   Tonight box, which still counts "new since the last dream" itself until the dashboard
   session switches it over (its `DashboardSource` does not carry `dreams` yet). The
   dashboard is an observer: it passes `owner: true` to preview the owner's own gate
   (confidential memories counted), or leaves it off for a guest's — its call.
   *(CLOSED 2026-09-27, then moot; noted 2026-10-09: `DashboardSource` gained `dreams`
   and the Tonight line read the gate's preview (#263, `8032668`), and the next day Home
   round 4 took the Tonight box out (#273, `2cc96b0`). With no caller left outside its
   own tests, `previewAsk` and `DashboardSource.dreams` were removed on 2026-10-09
   (NOTES). A dashboard that wants the gate again asks for it anew.)*

9. **Trait nudges have no reader in the core (2026-09-27), on purpose.** The dashboard's
   Self tab is to draw each axis as a firmness-weighted balance from `Store#traitsAll()`
   (or `traitsOn(ids)` for the memories it already holds); until it does, nudges are
   visible only in `export --markdown` and the `fired` row. A dream backfill of older
   memories is not built. *(The dashboard half CLOSED 2026-09-27 by #266 (`80720e0`),
   noted 2026-10-09: the Self tab's "How I act" draws the seven axes as firmness-weighted
   balances from `traitsAll` (`dashboard/web/views/traits.ts`). The core still has no
   reader, on purpose, and the backfill is still not built.)*

10. **Contradictions (2026-09-29).** The dream flags and may settle; the reflection may
    settle. Not built: the PAGE WRITER has no settle door of its own — a night-run
    `note` settle is attributed to the launching session on the trail. The dream bundle
    shows unsettled pairs on "my mind" by their two memories, not by pair id (the settle
    action takes `holds` / `over`, so it does not need it).
