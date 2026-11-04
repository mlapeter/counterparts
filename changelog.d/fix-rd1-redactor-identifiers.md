- **Tokenizer code is no longer redacted.** `pad_token = eos_token` and other lines that
  assign one identifier to another (a snake_case or camelCase word, no literal, no digit)
  are kept as written; quoted values, digits and passwords still redact as before.
