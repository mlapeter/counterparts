- **Tokenizer code is no longer redacted.** `pad_token = eos_token` and other code lines
  that assign one identifier to another whose last word is token, key or id (letters only,
  no digit, lowercase name, `=`) are kept as written; env vars, YAML, passphrase-shaped
  values, quoted values, digits and passwords still redact as before.
