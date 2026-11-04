- **Help no longer says export is encrypted by default.** It never was: export refuses until you pass
  `--passphrase` (encrypted) or `--plaintext` (said on purpose). `counterparts --help`, `counterparts export --help`,
  the README and the quickstart now say so.
- **On claude.ai, the `scope` tool speaks of one memory, not folders.** Its description, its read and the refusal
  while memory is off or paused say one account is one memory, to pause, turn off and turn back on; they no longer
  show the server's file path or a `counterparts scope` command nobody on claude.ai can run. Claude Code's and
  Claude Desktop's words are unchanged.
- **A new store's starter note on using memory well points to the manual** (`recall` the handle "manual"). Stores
  that already exist keep their notes as they are.
