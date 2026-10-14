- **Routine work is left at the default salience.** The `salience` field on `remember` and
  `session_end` now tells Claude to leave it unset for a routine work event or an ordinary
  work fact unless it changed something, and to claim 0.4 or more only for what struck it
  or changed how it will work, so weak work memories fade on their own. The owner's
  rulings and corrections still stay high.
