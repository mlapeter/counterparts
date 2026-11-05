- **A hosted "Download my memory" file opens in a local install and answers questions straight
  away.** The download carries only the memory file, not its search index, so a question used to
  find nothing until `counterparts verify --rebuild` was run by hand. Now the first session that
  opens a memory with an empty search index rebuilds it, whichever way it opens (Claude Code,
  Claude Desktop, the console, the background worker). Search by meaning fills in as usual.
  `counterparts doctor` shows a "Word index" line when the index is empty (amber) and for a week
  after an open rebuilt it, and `counterparts ask`, which only looks, says why it found nothing.
- **Starter notes follow the memory to where it's opened.** A hosted memory opened by a local
  install gets the local wording of its starter notes (terminal commands instead of the account
  page), and a local memory opened on hosted gets hosted's. Only notes still exactly as they
  started change; one you corrected stays as it is.
- **The manual has a section on taking your hosted memory home:** where the downloaded file goes,
  that it replaces the local memory there, and to export the local one first.
- **Hosted's account page:** the download is now marked as not encrypted ("keep it somewhere
  safe"), and the delete section says a single memory can be deleted by asking Claude, with 24
  hours to undo it, instead of saying it can't.
