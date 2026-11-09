### Decided by the SX1 builder, 2026-11-09, lightly held (passwords named in a sentence)

- Decided by the builder, lightly held: the new family is named `password`, not folded into
  `assigned-credential`, so the marker reads "my wifi password is [REDACTED:password]" and a week's
  `gate.deposit` count can say how often a sentence carried one. Where: `encode/secrets.ts#SECRET_FAMILIES`.
- Decided with the coordinator (fix round of #788): a missed password costs more than a cut word, so
  where the choice is between the two the gate takes the word. Two known cuts ("the password is
  important / irrelevant") and four known misses (no password name nearby, or the value only after
  "so") are rows in the test, each with its reason in the PR.
- Decided by the builder, lightly held: the family finds an anchor with a regex and reads the value in
  code (`SecretPattern.extent`, `proseValue`), because "a lowercase word with more of the clause after
  it is the sentence" and "a passphrase runs to the end of its clause" are not clear as regexes.
- Decided by the builder, lightly held: `:` and `=` straight after a name stay the catch-all's (with its
  code guards); `pw` and `passcode` joined its names. `pass:` counts only where a field starts, since
  "first pass: 74%" is prose. `pwd`, `code` and `key` alone are not names.
- Decided by the builder, lightly held: the raw-buffer scan is injected into `SpanBuffer` by `Counterpart`
  (`BufferOptions.redact`), keeping `remember/`'s rule that it never gates by itself; the span is hashed
  after redaction. Lines already on disk are not migrated; they leave under raw retention.
- Decided by the builder, lightly held: other languages only where one name and one verb were enough
  (Spanish, French, German, Portuguese), each with a few "wrong / empty / required" words.
