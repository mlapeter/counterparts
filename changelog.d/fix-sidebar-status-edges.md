- **The sidebar keeps its numbers beside an npm install when the plugin is loaded from a
  folder.** A plugin started with `claude --plugin-dir` stands its own server down there, and
  until now nothing told the npm install's processes the sidebar was present, so they deleted
  its status file. The stood-down server now leaves a small marker beside the configuration
  while its session runs (`sidebar-plugin-here`, refreshed every ten minutes, counted for
  thirty), and the memory server asks again at each write instead of once at its start.
- **After a rollback or a snapshot restore the sidebar catches up straight away.** A status
  file written before the store was put back named a later point in the log than the log now
  has, and both the writers and the sidebar kept it until the log caught up. A writer now
  replaces a file that is ahead of the log, and the sidebar accepts an older point in the log
  from the same store when the file is more than five seconds newer.
- **The store's note of where the sidebar file lives no longer disappears every week.** It is
  touched on every write, so the session-start cleanup keeps it.
