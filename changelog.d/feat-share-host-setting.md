- **A host can turn the morning share off, or cap it.** A product built on Counterparts can set `shares: "off"`, or
  `sharesPerWeek` to a number, in its configuration (or through hosted's `createApp`). The night still reflects and
  writes its entry; it just doesn't offer a share. While shares are held, nothing that would change who it is goes
  unsaid: a thread it would have closed is listed as "may be done", and a change to its core waits for a night that
  can tell you. The cap counts the shares offered over the last 7 calendar days; 0 is the same as off, and with
  shares off a share offered earlier isn't told either. Without the setting, nothing changes.
