- **`recall` loads up front in Claude Code.** Claude Code keeps most MCP tools behind its tool search
  until they are needed; `recall` now asks to be loaded from the start, so a session can look
  something up without first searching for the tool. Its description is tightened to fit Claude
  Code's limit for tools loaded this way. Claude Desktop and claude.ai are unchanged.
- **Each turn's recall record says which check kept a memory's words from showing.** The
  `recall.decision` row now names the check that kept a memory's words off the turn (the strong
  floor, the cue fraction, the bar and so on), with up to five memories that did not show at all,
  closest to the threshold each one missed first. It holds ids and numbers only. What recall shows
  is unchanged.
