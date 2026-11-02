- **Hosted: Litestream's own log lines reach the server's log.** A backup that fails to sync (a refused upload, an
  R2 permission error, a rejected encryption key) now says so in the log, and a redeploy's log shows Litestream's
  final sync finishing. Before, those lines were dropped and only the process being up was visible.
