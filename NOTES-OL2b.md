# NOTES-OL2b — the hosted server's ops pieces (feat/hosted-ops)

Progress file for a successor; folded into `hosted/NOTES.md` before the PR is ready.
Brief: `~/counterparts-notes/2026-10-26-briefs/OL2b-hosted-ops.md`. Branched from master 6699b892.

## Plan (in build order)

1. restore: `KeyStore.adopt`, `Backups.restore` (control + stores), `main.ts restore`, drill test with a stand-in binary
2. the fresh-dir guard: a store that has a key but no dir is refused, not re-initialized (it would overwrite its backup)
3. `/readyz`
4. `/mcp` rate limit, in-flight cap, size quota
5. DCR client sweep
6. Dockerfile (Node 24 + Litestream 0.5.17, pinned by sha256)
7. `docs/hosted/RUNBOOK.md`

## Done

(nothing yet)

## Learned

- Litestream v0.5.17 source (read, not run): the SSE-C keys are `sse-customer-key-path` (as generated);
  `restore` takes `-config` OR a replica URL, never both, so SSE-C restore needs the store in a config;
  `shutdown-sync-timeout` exists, so v0.5 does a final sync on SIGTERM; `-if-replica-exists` exists.
- The classifier refuses downloading and running the Litestream binary on this Mac: the hermetic drill
  uses a stand-in binary; the real-binary drill is a runbook step.
