# hosted/ — what it still owes

1. **Keys, backups, export and delete** (DESIGN §5, build step 5). These wait on Mike: the Q4 wording, who holds the
   key, the §5.2 privacy paragraph, and whether the native-driver spike may run. Until then:
   - deleting an account is an operator task;
   - the `oauth.revokeAll` and `tenants.close` building blocks exist;
   - nothing is backed up.
2. **Operations** (DESIGN §7, build step 6): the Dockerfile, the Litestream sidecar, `/readyz`, alerts, the runbook,
   and the Fly fallback.
3. **Rate limit and quota on `/mcp`.** Per-person calls a minute and the per-store size quota aren't built. The login
   form and the OAuth register and token endpoints are limited per IP.
4. **Unused DCR clients pile up.** Claude registers a new client on every fresh connection. Sweeping clients older than
   30 days that hold no grant is not built.
5. **Refresh sliding vs absolute.** oidc-provider rotates the refresh token on every use, with a 30-day TTL. Whether
   the rotated token's expiry slides (Q11's "no absolute cap") was not measured: it would need the clock moved inside
   the library.
6. **The 2026-07-28 transport** (DESIGN §3): `server/discover`, per-request `_meta`, `resultType`, and the
   `Mcp-Method`/`Mcp-Name` headers, behind a version switch.
7. **High security review** (DESIGN §9 step 7) before anyone outside the family.
