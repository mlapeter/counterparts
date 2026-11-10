- **Hosted: an hourly cap on sign-in emails while spots are open.** While anyone can sign up by email, hosted sends
  at most 100 sign-in emails an hour (the operator changes it with `spots emails M`), counted in the control
  database so a deploy doesn't reset it. Past it, a new address waits for the next hour and the page says "lots of
  people are signing up right now" to everyone alike; people with an account still get their sign-in link.
