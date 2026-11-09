- **A password said in a sentence isn't kept.** "My wifi password is …", "the PIN is …", "pw for the router
  is …": the value is replaced with `[REDACTED:password]` and the sentence stays, so the memory still says there is
  one. Ordinary sentences about passwords ("I forgot my password", "the password field is empty") are left alone.
- **The raw conversation text gets the same stripping.** What's kept of a conversation until it's written up now
  goes through the same check as a memory before it's saved, on your machine and on hosted. Text saved before this
  version isn't rewritten; it's deleted on its usual schedule. Not every secret has a shape: don't paste things you
  wouldn't want kept.
