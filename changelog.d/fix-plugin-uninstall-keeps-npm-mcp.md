- **Uninstalling the plugin no longer takes the npm install's memory server with it.** With
  both installed, the plugin's uninstall (keeping the memories) ran `claude mcp remove
  counterparts -s user`, which removed the server the npm install registered. The plugin
  never registers one there, so it now leaves it alone and says so; `counterparts
  uninstall` still removes its own.
