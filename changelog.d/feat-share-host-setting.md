- **A host can turn the morning share off, or cap it.** A product built on Counterparts can set `shares: "off"`, or
  `sharesPerWeek` to a number, in its configuration (or through hosted's `createApp`). The night still reflects and
  writes its entry; it just doesn't offer a share, and a thread it would have closed is listed as "may be done"
  instead. The cap counts the shares offered over the last 7 days. Without the setting, nothing changes.
