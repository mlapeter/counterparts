# remote/ — what it still owes

1. **Sign-in.** No OAuth; the per-run secret path is the gate. Before anyone but the owner
   uses this, it needs the OAuth 2.1 flow claude.ai expects (DCR or CIMD, PKCE S256, a
   `401` with `resource_metadata`).
2. **A conversation's calls, bound by its connection.** A call that names no session falls
   back to the most recent claude.ai session, which may be another conversation's (Desktop
   has the same gap). If the trial shows one `Mcp-Session-Id` per conversation, the
   connection could carry its wake's session instead.
3. **The night for claude.ai sessions.** There is no transcript, so the catch-up has
   nothing to write up; `cli/coverage.ts` and `claude-code/doctor-write-ups.ts` count
   Desktop's sessions by host and do not yet name claude.ai's. The tagging child's `tags`
   phase is served only to the nightly run's own child, so a night run from claude.ai (a
   scheduled task, or by hand) does day's end, the dream and the reflection through the
   tools, and skips tagging.
4. **Protocol versions.** `mcp/protocol.ts` echoes 2025-11-25 since OL2 step 1 (2026-10-26); claude.ai offers
   it and is answered in it. A version this server does not know is still answered with
   2025-06-18. The 2026-07-28 revision (stateless) is `docs/hosted/DESIGN.md` §3, later.
5. **Doctor.** No claude.ai line: nothing reads the call log but the trial script.
6. **No console command.** Run by path (`bin/serve-http.ts`); see CONTRACT.
