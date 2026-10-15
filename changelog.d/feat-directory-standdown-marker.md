- **The plugin from Anthropic's directory stands down beside the npm install.** It reads none
  of Claude Code's files, so it couldn't tell the npm install was there, and Claude was
  offered every memory tool twice. The npm install now leaves a small note beside its
  configuration, `~/.counterparts/npm-live.json`, when it connects and about once a day
  while its hooks run; the plugin's hooks and server stand down while the note is under a
  week old and the program it names is still installed. `counterparts disconnect` and
  `uninstall` remove it.
- **Installed twice now recommends keeping one.** The session-start line, the stood-down
  server's note and `counterparts doctor` no longer say "nothing needs to change": both use
  the same memory, so nothing is lost either way, and they name both ways out, `counterparts
  disconnect` (keep the plugin) or `/plugin uninstall counterparts@…` (keep the npm install).
