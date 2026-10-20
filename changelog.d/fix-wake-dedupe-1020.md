- **The session-start wake names each session once.** The Yesterday line leaves the newest
  chapter written in this folder to "Last here", and "Last here"'s "Before it" and "+N more
  here" lines, and the chapter-about-me line, leave out what Yesterday already names. A
  Yesterday chapter with no room for its title is counted ("and 3 more"), never printed as a
  bare id.
- **One tag at the top of the wake.** The meeting's state and the store's id are now fields of
  the wake's own opening comment (`<!-- counterparts:wake meet=done store=st_… elements=…
  bytes=… -->`), or of one `<!-- counterparts:session … -->` tag when there is no wake to
  carry them. The sidebar reads both forms. An older sidebar (plugin 0.3.27 or before) reads
  them as unknown until the plugin is updated: it skips its store check and keeps the
  "5-minute intro" line in its footer.
- **The chapter-about-me line says where it is from first**: "A chapter about me from
  ~/site: session …, Oct 19 — "…" (epi_…)."
- **"Coming up" at a session start lists what is due today.** A plain reminder due tomorrow is
  counted with the other dates, as the evening's bundle still lists it for the next morning.
  Every "Coming up" item now carries its own id, beside any "(earlier: …)" pointer.
- **One backup a day, even when two background runs start at once.** The daily snapshot
  claims the day before it copies, so two runs at one boundary no longer leave two copies.
