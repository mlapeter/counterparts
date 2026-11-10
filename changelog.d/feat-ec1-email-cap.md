- **Hosted: an hourly cap on sign-up emails while spots are open.** While anyone can sign up by email, hosted counts
  the sign-in asks each hour; once 100 are counted (the operator changes it with `spots emails M`), a new address
  waits for the next hour and the page says "lots of people are signing up right now" to everyone alike. People
  with an account, or a live invite code, still get their link. The count is kept in the control database, so a deploy doesn't
  reset it.
