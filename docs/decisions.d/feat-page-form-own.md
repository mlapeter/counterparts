### One store's nightly writers keep the page's own form (PF1), designed by ROADMAP 2026-11-01, built off by default

- Why: on 10-31 Mike asked why the counterpart writes lessons "on stone tablets"; on 11-01 it rewrote its own page
  (v72) as dated stories with the lesson inside, a "Practices, no story yet" list and a short "Firm" section, with no
  "## How I work". The page's form carries identity, and the nightly writers were told to turn it back into short
  general lessons (`HOW_I_WORK_RULE`, 2026-10-16). Asked by the counterpart in ~/random, with Mike's yes on 11-01.
- What: a meta row `self.page_form` = `own` (`counterparts page-form own|default`). With it, day's end and the
  reflection are told "Amend the page in its own form: keep its sections and headings as they stand, dated stories
  where it tells stories and plain lines where it doesn't." in place of `HOW_I_WORK_RULE`, and no instruction names
  "## How I work". Words only: nothing checks a heading, room (4,600), cadence, the door and the wake are untouched.
- Scope: Mike's store only, switched on after he installs the release. Every other store has no row and is told
  byte for byte what it was (proved against master on every tunable combination in the PR).
- `default` empties the row rather than deleting it (the store has no meta delete; WK2's switch does the same), and an
  empty row reads as absent. A store that won't answer reads as absent too.
- Undo: `counterparts page-form default`, from the next night, no restart. Every page version is kept: v71 is the
  last rules page, restored by writing its text as a new version through the self_page tool. The pages and claims
  nights write in between stay in history, superseded, not deleted. Nothing moves in the store format.
