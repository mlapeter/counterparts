- **The sidebar is a plugin of its own: `counterparts-sidebar`.** `counterparts` is now the
  memory alone (hooks, memory server, commands); the pane beside the chat comes with
  `/plugin install counterparts-sidebar@counterparts`, which installs `counterparts` too
  if it isn't there. If you already have the plugin, `claude plugin update
  counterparts@counterparts` moves you to memory alone and the sidebar goes until you
  install it; installing the sidebar before that update stops and tells you to run it, so
  you never get two panes. The sidebar starts with the default view, theme and avatar.
  With the npm install, adding the sidebar plugin gives one pane and every memory tool
  once, as before.
