- **The sidebar shows memory and no longer acts.** It has no buttons: the "Start the
  5-minute intro" row, the folder switch (on, paused, off) and its confirm, and the view and
  avatar switches are gone. Its footer says how instead: `/counterparts:meet` for the intro,
  `/counterparts:dashboard` for the dashboard, say "pause memory here" to Claude to pause a
  folder, `/counterparts quiet` to hide it. A paused folder still says so, with how to
  resume; `/counterparts resume` now says how rather than resuming.
- **The sidebar's brain is gone; the fox stays.** `/counterparts avatar` takes `animal` or
  `off`; a brain chosen before shows the fox. `/counterparts fps` is gone with it.
- **The sidebar always reads the dashboard at `http://127.0.0.1:4747`.** It no longer
  follows `COUNTERPARTS_DASHBOARD_PORT`; a dashboard started on another port isn't shown
  there.
