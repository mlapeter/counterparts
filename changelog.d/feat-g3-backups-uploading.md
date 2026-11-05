- **Hosted: `/readyz` says when backups stop reaching the bucket.** The hosted server now checks
  every 10 minutes that its backups are actually landing in storage, not only that the backup
  process runs. After 30 minutes with nothing landing, `/readyz` answers `503` with
  `backups: "stale"`, and the log says so with a `backup.uploads.stale` line. A fresh start gets
  those 30 minutes before it can read stale.
