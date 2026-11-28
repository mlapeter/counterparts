- **Settling two memories says to send the settle alone.** The `settle` field and the hint
  that comes back with a write's neighbours now say: send settle by itself, the reason in
  `why`; a `text` sent beside it is stored as a separate new memory. A writer had been
  sending the new value as text too, and it was kept as a duplicate.
