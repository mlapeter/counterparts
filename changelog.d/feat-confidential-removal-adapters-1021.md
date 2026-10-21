- **The dashboard, the sidebar and the console show every memory's words.** A memory
  that carried the old confidential key reads like any other on every page (the card,
  the list, search, Today, traits, the journal and the dreams), in the sidebar, in the
  `remove` list and in `dream`, `night` and `core --list`, where the `[confidential]`
  marker is gone.
- **`export --markdown` carries everything.** Every live memory, earlier wording,
  dream and reflection is in the tree, and the manifest no longer has an "omitted"
  line. `--include-confidential` is still accepted for one release, does nothing, and
  says so in one line; it goes in the release after. Without `--markdown` it is still
  refused by name, as before.
- **Doctor's mechanism census has one row fewer**: the "confidentiality" row is gone,
  with the gate it counted.
