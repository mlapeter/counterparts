- **Uninstall names the right remover and cleans up after itself.** Its last line says
  `npm uninstall -g counterparts` for an npm install and `bun remove -g counterparts` for a
  bun one (both when it can't tell), where it used to say the bun line to everyone. It also
  removes the backups of `~/.claude/settings.json` that connecting and disconnecting kept,
  and says so when the settings file is left as `{}`.
- **The docs say what goes over the network.** README, the quickstart and setup now say the
  one request Counterparts makes of its own: a daily check of registry.npmjs.org for the
  newest version number, sending nothing about you, which `COUNTERPARTS_UPDATE_CHECK=off`
  or Claude Code's `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` stops. The export example now
  works as shown (`--out` with `--passphrase` or `--plaintext`), and the docs say no command
  opens an encrypted export yet.
