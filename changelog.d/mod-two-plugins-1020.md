- **The sidebar is a plugin of its own: `counterparts-sidebar`.** `counterparts` is now the
  memory alone (hooks, memory server, commands); the pane beside the chat comes with
  `/plugin install counterparts-sidebar@counterparts`, which installs `counterparts` too
  if it isn't there. If you already have the plugin, `claude plugin update
  counterparts@counterparts` moves you to memory alone and the sidebar goes until you
  install it; installing the sidebar before that update stops and tells you to run it, so
  you never get two panes. The sidebar starts with the default view, theme and avatar.
  With the npm install, adding the sidebar plugin gives one pane and every memory tool
  once, as before.
- **Doctor beside the sidebar plugin.** With the npm install, the `counterparts` plugin and
  the `counterparts-sidebar` plugin (the way to get the sidebar with the npm install), doctor's
  Claude Code line is green now: it says the plugin is installed for the sidebar, which needs
  it, and stands down. It is amber only when both installs really run (a plugin build that
  doesn't stand down), and then it says to update the plugin, never to uninstall it.
  <!-- FOR MIKE TO REVIEW (coordinator's call, 2026-10-22): this was the amber "Installed twice" before; green is new. Drop this comment when the changelog is cut. -->
- **The first meeting's close** names `/counterparts` only where a sidebar answers it: with
  the sidebar plugin (installed, on, and with a `counterparts` it accepts), or a
  `counterparts` plugin from before the split. That now includes the npm install beside
  the sidebar plugin.
