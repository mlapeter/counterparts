- **Under Node, a deleted row's words no longer linger in the database file.** Node's built-in
  SQLite leaves `secure_delete` off, so a deleted or rewritten row stayed in the file's free space
  until the page was reused. The store now sets it to FAST on every open, as it already was under
  Bun.
