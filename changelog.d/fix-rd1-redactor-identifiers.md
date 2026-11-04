- **Tokenizer code is no longer redacted.** `pad_token = eos_token` and other code lines
  that assign one identifier to another whose last word is token, key or id (letters only,
  no digit, lowercase name, `=`) are kept as written; env vars, YAML, passphrase-shaped
  values, quoted values, digits and passwords still redact as before.
- **More credential names are redacted.** `passphrase`, `db_pass` and other `*_pass` names,
  a whole-name `pin` with a numeric value, `private_key`, `signing_key`, `session_key`
  and a bare capitalised `AUTH=` / `BEARER=` now keep their name and lose their value;
  `pin_memory=True`, `session_key_fn` and key-file paths such as `private_key = "keys/a.pem"`
  stay readable.
