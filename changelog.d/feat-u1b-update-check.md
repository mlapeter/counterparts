- **Counterparts now tells you when an update is out.** Once a day, it asks the npm registry
  (`registry.npmjs.org`) for the newest version number. The request carries no memory, no
  conversation, no identifier, not even which version you have; because it's daily, npm
  can see your computer's network address and that Counterparts checked that day. When
  you're a few releases behind, or a release is worth taking, your Claude mentions it once,
  with the steps for how you installed. **To turn it off, tell your Claude to stop
  reminding you about updates, or set `"updateCheck": false` in
  `~/.counterparts/claude-code.json` (or `COUNTERPARTS_UPDATE_CHECK=off`).** It doesn't
  run under Claude Code's `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`; a copy that checks
  nothing says once a month when it's over 30 days old instead. `counterparts doctor` has
  an Updates line.
- **Plugin users are offered Claude Code's own auto-update, once.** /plugin → Marketplaces →
  counterparts → Enable auto-update keeps Counterparts current without asking.
- **The plugin's update step is now Update marketplace.** Fix lines say /plugin →
  Marketplaces → counterparts → Update marketplace, which refreshes the listing before it
  updates, instead of Installed → Update now.
- **npm lines say `@latest`.** Doctor's and the wake's npm steps say
  `npm install -g counterparts@latest`: on Node 20 the bare form quietly installs 0.3.10.
