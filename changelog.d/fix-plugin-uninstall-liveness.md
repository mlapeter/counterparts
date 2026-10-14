- **Uninstalling the plugin leaves a working npm install's hooks alone too, and cleans up
  after one that is gone.** With both installed, the plugin's uninstall (keeping the
  memories) took the npm install's wake and recall hooks out of `~/.claude/settings.json`.
  It now removes a Counterparts hook or memory server only when the program it runs is no
  longer there, which is what an npm install removed without `counterparts uninstall`
  leaves behind. Run at a terminal, the plugin's uninstall now asks whether to delete the
  memories before it removes anything of the npm install's, so answering no leaves that
  install working.
