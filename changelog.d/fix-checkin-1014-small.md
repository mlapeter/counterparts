- **Routine work is left at the default salience.** The `salience` field on `remember` and
  `session_end` now tells Claude to leave it unset for a routine work event or an ordinary
  work fact unless it changed something, and to claim 0.4 or more only for what struck it
  or changed how it will work, so weak work memories fade on their own. The owner's
  rulings and corrections still stay high.
- **A faded match is labelled "faded: weak, below reach".** Asking for facts used to label
  it "not used for a long while", which was false for a memory two days old that simply
  started weak. The dashboard's search says the same. Ranking is unchanged.
- **`recall` takes `query` as another name for `question`.** A recall sent with `query`
  used to be refused for having no question; it is now answered as one. A mode is still
  required.
- **Closing a reminder closes all of it.** When a memory says a dated thing is done (its
  date dropped, or `status: done`), every earlier or later memory the same reminder moved
  through loses its date too, so one "done" stops it coming back. Other memories nearby
  that still hold a date are listed in the reply, by id and title, so Claude can close
  them in the same step if they are the same thing; they are never closed for it.
