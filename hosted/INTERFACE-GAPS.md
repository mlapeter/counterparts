# hosted/ — what it still owes

1. **Two gates before any non-family user** (DESIGN §5.4):
   - Railway's disk encryption confirmed in writing;
   - the Cloudflare Worker key service (a second `KeyWrapper`), so that one leak of Railway's environment can't expose
     both the KEK and the R2 credentials.
2. **The control databases' backup history.** It keeps a deleted person's address and audit codes until Litestream's
   snapshot retention (24 h by default) ages them out. The fix: the address encrypted under the person's DEK, plus a
   keyed hash for lookup.
3. **Restore.** Nothing restores yet: the R2 objects to keys, then Litestream restore, then a drill against a local S3
   stand-in. This comes with the ops step's runbook.
4. **Operations** (DESIGN §7, build step 6): the Dockerfile (Node 24 plus a pinned Litestream binary), `/readyz` with
   replication lag, alerts, the runbook, and the Fly fallback.
   - Whether Litestream v0.5 reloads its config on a signal is unmeasured. The sidecar restarts instead.
5. **A rate limit and quota on `/mcp`.** Per-person calls a minute and the per-store size quota are not built yet.
6. **Unused DCR clients pile up.** A sweep of clients older than 30 days that hold no grant is not built.
7. **Refresh sliding vs absolute.** Whether the rotated refresh token's 30-day expiry slides was not measured.
8. **Export as markdown.** Export is the database file. The readable markdown tree needs an archive format, and is not
   built.
9. **The 2026-07-28 transport** (DESIGN §3), behind a version switch.
10. **A high security review** (DESIGN §9 step 7) before anyone outside the family.
