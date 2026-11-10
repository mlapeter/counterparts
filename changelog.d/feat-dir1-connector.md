- **Hosted (claude.ai): a lighter, plainer tool list, ready for Anthropic's connector directory.** The tools
  claude.ai loads are about 40% smaller (67 KB to 40 KB) and say plainly what each does; Memory status and recall are
  marked read-only (they save and delete nothing), and deleting a memory is its own tool, `delete_memory`, marked as
  one that deletes (hidden at once, erased after 24 hours, undo before then, as before). Claude Code's and Claude
  Desktop's tools are unchanged.
- **Hosted: Claude Code can sign in.** Adding `https://app.counterparts.ai/mcp` to Claude Code now completes the
  sign-in (it was refused with "invalid_redirect_uri").
- **Hosted: clearer error messages.** A refused request says what happened and what to do, instead of a bare number.
