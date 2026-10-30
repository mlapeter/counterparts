- **Turning a folder off now reaches the sessions already captured there.** The night's catch-up,
  `counterparts catch-up` and the write-up pointer used to take every owed session whatever its
  folder's setting, so a later night could write memories from a folder you had since set off. A
  session in a folder that is off, observer or paused (a subfolder of one included) is now left out,
  isn't counted as owed in doctor or by the night, and shows as such in `counterparts coverage`. A paused
  folder you resume is owed again until its text ages out. Memories already written stay as they are.
  While `scopes.json` won't read, write-ups stop, and doctor, `counterparts coverage`, `counterparts catch-up`
  and the session-start line all say so and name the file.
- **`counterparts verify --rebuild --keep-vectors` no longer reports a false mismatch.** It counted
  archived and superseded rows as unaccounted for and exited with an error; no row was ever missing.
