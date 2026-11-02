- **The plugin downloads its program once on Ubuntu 26.04.** On a computer with no Bun or Node,
  the hook and the memory server starting together could both download the program (about
  56 MB), because that Ubuntu's `mkdir` can tell two processes they each made the same
  directory. The launcher now takes its lock with the shell itself. The same double download
  could follow a download that died, on any system, and now doesn't. Nothing unchecked ever
  ran: each download was checked and moved into place in one step. And on a Mac whose `sh`
  is zsh, a first start now downloads the program at all: it used to say "getting ready"
  and never start.
