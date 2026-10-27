- **`counterparts connect` keeps Counterparts Online out of Claude Code.** Claude Code loads
  your claude.ai connectors into every session, so with both this install and the hosted
  connector you would get two memories over two stores. `connect` (and so `install`) now adds
  one entry, `{ "serverUrl": "https://app.counterparts.ai/*" }`, to `deniedMcpServers` in
  `~/.claude/settings.json`, with the same backup and leaving everything else as it is;
  `disconnect` takes out exactly that entry. `doctor` has an Online line; an install from
  before this version reads amber there until you run `counterparts connect` once.
- **Your memory is private to your account on this computer.** The store, its snapshots and
  everything Counterparts writes under `~/.counterparts` are now readable by you alone
  (folders 700, files 600; they were 755 and 644). An existing store is tightened the first
  time this version writes to it; a drive that doesn't keep permissions (exFAT, some network
  drives) is left as it is and still opens. `doctor` has a Privacy line that says when the
  store is readable by other accounts, with the two commands that close it.
- **`backup --out` and `export` write private copies** (the database `600` in a `700`
  folder) wherever you point them. A store you share with a group on purpose is made
  private again the next time Counterparts writes to it; there is no switch for that yet.
