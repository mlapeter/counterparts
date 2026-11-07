- **A done memory is never overdue.** A memory marked `status: done` whose date is today
  or already passed now reads that date as when it happened: it leaves Coming up (due
  today included), the overdue count and the plain-reminder line, older memories
  included. Writing one through `remember` or `session_end` stores the date as
  `occurredOn` and says so beside the memory. A repeating reminder is unchanged: a done
  there still closes only this time.
