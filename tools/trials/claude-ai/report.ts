/**
 * The claude.ai trial's call log, read back PER CHAT (2026-10-26, OL1b):
 * claude.ai reuses one connection across chats, so a chat is the session its
 * `wake` minted, and every later call that named it. Calls that named no
 * session are counted apart, per connection.
 *
 *   bun tools/trials/claude-ai/report.ts <calls.jsonl>
 */
import { summarizeChats } from "../../../src/adapters/remote/call-log.js";

const path = process.argv[2];
if (path === undefined) {
  process.stderr.write("usage: report.ts <calls.jsonl>\n");
  process.exit(2);
}
const { chats, unnamed, clients } = summarizeChats(path);
if (chats.length === 0 && unnamed.length === 0) {
  process.stdout.write(`No tool calls logged yet at ${path}.\n`);
  process.exit(0);
}
const out = (s: string): void => void process.stdout.write(s);
out(`Client names seen at initialize: ${clients.length === 0 ? "(none)" : clients.join(", ")}\n\n`);
out("first seen (UTC)     chat      woke  calls  remembers  chapter  errors  tools\n");
for (const c of chats) {
  out(
    `${c.firstAt.slice(0, 19).padEnd(19)}  ${c.session.slice(0, 8)}  ${(c.woke ? "yes" : "no").padEnd(4)}  ${String(c.calls).padStart(5)}  ${String(c.remembered).padStart(9)}  ${(c.chapter ? "yes" : "no").padEnd(7)}  ${String(c.errors).padStart(6)}  ${c.tools.join(" ")}\n`,
  );
}
const woke = chats.filter((c) => c.woke).length;
out(`\n${String(chats.length)} chats; ${String(woke)} woke in this log${chats.length > woke ? ` (${String(chats.length - woke)} named a session minted before this log)` : ""}.\n`);
if (unnamed.length > 0) {
  out("\nCalls that named no session (the server filed each under the most recent chat, which may be another's):\n");
  for (const u of unnamed) {
    out(`  connection ${u.connection.slice(0, 8)}: ${String(u.calls)} calls, ${String(u.beforeWake)} before any wake on it, ${String(u.errors)} errors — ${u.tools.join(" ")}\n`);
  }
}
out("\nA chat with no tool call at all leaves no row here: count those by hand.\n");
