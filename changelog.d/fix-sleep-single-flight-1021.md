- **One nightly cycle at a time.** When a session closed, its two end-of-session workers
  could both run the night's cycle at once: the card births ran twice (the doubled cards)
  and the wake was rendered twice. The cycle now holds the memory while it runs, and a
  second worker that arrives meanwhile still saves its associations, then leaves the cycle
  to the first, at once, and says so in the log. A worker that died mid-cycle gives way
  after ten minutes, and the next cycle finishes its work.
