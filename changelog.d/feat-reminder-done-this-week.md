- **A weekly reminder can be marked done for this week.** Saying a repeating reminder was done
  (a memory that updates it with `status: "done"`) closes just this time: it stops coming up
  today, the reminder keeps its date and repeat, and it comes back on its next date. The answer
  says which day was closed and when it returns. Dropping the date (`eventDate: null`) still
  ends the repeat.
- **A "done" note written on its own points at the reminder it answers.** When a memory saying
  something was done (or that you said it) lands next to a reminder due now, the answer names
  the reminder and how to close it.
- **A memory a session just replaced still counts as drawn on.** Naming in `drewOn` a memory the
  same session had just updated with a newer one (or one replaced that day) no longer refuses it.
  One put away by a correction is still refused.
