- **A nightly run that fails now says why.** When a background child of the nightly run exits
  with an error, the run's record, `counterparts doctor` and `dream --show` carry one short
  line of what Claude Code said (for example "Not logged in · Please run /login"), with
  anything that looks like a key or token blanked out. Before, it said only "claude exited
  with an error (exit 1)". A run that stopped because Claude Code was signed out, such as
  after switching accounts mid-run, now says so plainly, and the next session offers to dream
  there.
