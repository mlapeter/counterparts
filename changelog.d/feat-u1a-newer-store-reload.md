- **An open window that meets a memory a newer Counterparts upgraded says what to do.** For the plugin, it used to say
  "Run /mcp and Reconnect", which restarts the same old version. Now it says to run `/reload-plugins` (with `--force`
  if it warns about the cache), or start a new session (first, in Claude Desktop's Code tab), when Claude Code already
  has the newer version, and to update the plugin first when it doesn't. The npm install keeps "/mcp and Reconnect".
- **The hook in that window says the same, and tells the assistant too.** The red "memory is OFF … Run: counterparts
  doctor" line now names the step for how you installed (plugin installs have no `counterparts` command; an npm
  install is told to update itself), and the assistant gets a line so it doesn't act as if it remembers. Doctor's
  Store open line gives the same step.
- **After an upgrade, the next session you start names the windows that still run the old version.** Once, with the
  step for each (reload, or `/mcp` and Reconnect for npm); Claude Desktop's wake says it too.
- **"Counterparts was updated" names the right step for plugin users.** The once-a-session line after an update said
  "Run /mcp and Reconnect" to everyone; a plugin window is now told to run `/reload-plugins` or start a new session.
