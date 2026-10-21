### Decided by Mike, 2026-10-21 (confidential memories removed; the owner stance lightly held)

- Decided by Mike, 2026-10-21: remove the confidential-memories feature, thoroughly and
  carefully. Why: nobody used it, nothing in the product set the mark, it didn't really
  work, it added complexity, and it was never clear whom "confidential" protected. Three
  pull requests, one release: core and MCP behaviour first, then the adapters (dashboard,
  sidebar, export, CLI), then the leftover types.
- Existing marked rows: counted once at the first writable open after the upgrade
  (`confidential.retired`), with a doctor amber line only when the count is above 0.
  Nothing is archived.
- The column: inert (written 0, never read) and dropped in the next batched store-format
  change. No schema or cache version change now.
- The last exchange stays owner-only for now, lightly held. The reason written beside it
  was confidentiality; that reason is removed and no other is put in its place.
- The owner/guest stance stays for now, lightly held. What it still decides is closing a
  thread or reminder opened in another directory and the last exchange. Mike: "we almost
  need to have the 'the night run counts as you' convo to really know, i'm basically no
  longer sure if the rules about yours/guest make sense anymore or are even worth
  keeping." So `ownerMeans` and doctor's Mode line were reworded minimally, and nothing
  new was written to harden the stance.
- This replaces one sentence in the 10-20 unmarked-offer decision ("Confidential memories
  are never in the night's bundle, so never offered or re-marked"): every bundle is read
  the same now, so a memory carrying the old key is offered and marked like any other.
