---
description: Check Counterparts' health, for an install that came as this plugin
allowed-tools: Bash(sh:*)
---

Run this one command with the Bash tool and show the person its output as it is, without summarizing it away:

```
sh "${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh" cli doctor
```

It is Counterparts' own console (`counterparts doctor`), launched from the plugin because a plugin install puts no `counterparts` command on the PATH. If it reports a problem, its own lines say what to do.
