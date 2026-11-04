- **Uninstall names the right remover and cleans up after itself.** Its last line says
  `npm uninstall -g counterparts` for an npm install and `bun remove -g counterparts` for a
  bun one (both when it can't tell), where it used to say the bun line to everyone. When it
  takes its hooks out of `~/.claude/settings.json`, it also removes the backups of that file
  that connecting and disconnecting kept, and says so when the file is left as `{}`. When
  there were no hooks of ours in the file, the backups stay and it says where.
- **The docs say what goes over the network.** README, the quickstart and setup now say the
  one request Counterparts makes of its own: a daily check of registry.npmjs.org for the
  newest version number, sending nothing about you, and how to stop it (`"updateCheck":
  false` in the configuration, or asking Claude to stop the update reminders). The export example now
  works as shown (`--out` with `--passphrase` or `--plaintext`), and the docs say no command
  opens an encrypted export yet.
