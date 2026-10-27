- **`doctor`'s Privacy line is right about setgid folders and the snapshot mirror.** A store
  folder carrying a setgid or sticky bit (on Linux, a folder made inside a setgid one inherits
  it) is never changed by a session, so the line now gives the one command to run by hand
  (`chmod go-rwx …`, which keeps the bit) instead of saying the next session will do it. With a
  `snapshots.mirror` configured, the line says the mirror is not checked.
- **Installing through a `~/.counterparts` link to a folder that is not there yet** now says so
  and how to fix it (make the folder, or remove the link), instead of a bare `ENOENT`.
