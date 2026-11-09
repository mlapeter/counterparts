### Decided by the SX1 builder, 2026-11-09, lightly held (passwords named in a sentence)

- Decided by the builder, lightly held: the new family is named `password`, not folded into
  `assigned-credential`, so the marker reads "my wifi password is [REDACTED:password]" and a week's
  `gate.deposit` count can say how often a sentence carried one. Where: `encode/secrets.ts#SECRET_FAMILIES`.
- Decided by the builder, lightly held: the prose family takes is / was / 's / a spaced dash and a bare value with
  a digit; `:` and `=` stay the catch-all's (which has the code guards), with `pw` and `passcode` added to its names.
  Why: `password: string` and `pw = getpass()` are code, and the catch-all already knows them.
- Decided by the builder, lightly held: an ordinary word after the verb is the sentence (a stop list plus a
  letters-only adjective/participle ending), and a PIN is 4–12 digits. The trade: a password that is itself one of
  those words ("fabulous") is kept. `pwd` is not a prose name (the working directory). Where: `isProseWord`.
- Decided by the builder, lightly held: the raw-buffer scan is injected into `SpanBuffer` by `Counterpart`
  (`BufferOptions.redact`), keeping `remember/`'s rule that it never gates by itself; the span is hashed after
  redaction. Lines already on disk are not migrated; they leave under raw retention.
- Decided by the builder, lightly held: other languages only where one name and one verb were enough (Spanish,
  French, German, Portuguese), each with a few "wrong / empty / required" words in the stop list.
