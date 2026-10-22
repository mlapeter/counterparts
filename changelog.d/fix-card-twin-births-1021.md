- **A name no longer gets two cards.** When a session closed, its two end-of-session
  workers could both run the night's card births at once, and each gave the same names a
  card of its own: Google and Google, Bash and Bash, all with the same birth day. A card is
  now born only after checking, with the store locked, that no other process has just made
  it. Cards already doubled stay doubled for now; merging them comes separately.
