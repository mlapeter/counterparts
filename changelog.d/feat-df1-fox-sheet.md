- **The sidebar's fox ships as one file instead of 36.** He looks the same: the same PNGs, kept one
  after another in `art/fox/fox.pngs`. The plugin directory takes 512 files, and this frees 34. A
  picture now reaches the terminal as bytes, so `/counterparts avatar detail images` draws one in
  iTerm2 3.5 or later (and in tmux with passthrough on), and kitty, Ghostty and iTerm2 draw one over
  ssh, where they couldn't before. `auto` keeps sextants or half-blocks in iTerm2 and tmux, as it did,
  except over ssh, where the sidebar can't tell which terminal it is.
