- **Hosted: a sign-in or account page left open across a server update still works.** The forms' key now comes from
  the server's cookie keys, so an update no longer answers "This form expired"; only a deliberate key rotation does.
- **The first meeting's last question no longer looks like "the meeting has started".** Its step is now called
  `origin` (the old name `started` still works with an answer), the script says that choosing "Now" needs no call, and
  a bare call to it gets plain words saying the meeting begins with `meet` and no step.
- **On claude.ai and Claude Desktop, Memory status is no longer marked read-only.** A status call there that names its
  conversation updates that conversation's record, so the read-only label wasn't true; in Claude Code it still is.
