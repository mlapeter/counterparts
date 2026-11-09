- **Counterparts runs on Windows.** Install it with npm (`npm install -g counterparts@latest`) and Node 22.15 or newer,
  from PowerShell, cmd or Git Bash, then `counterparts` and `counterparts connect` as on macOS and Linux. The hooks
  `connect` writes run whether Claude Code uses Git Bash or PowerShell for them, and the memory tools register with
  Claude Code installed either way (its installer or npm). It's new and has few users yet: tell us how it goes.
  Under WSL it works as on Linux. QUICKSTART's "On Windows" says what differs.
- **No console windows flash up on Windows** for the background worker, the night or its `claude -p`.
