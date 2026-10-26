/**
 * The claude.ai trial's call log, read back: per connection, whether `wake`
 * came first, how many `remember`s, and what the client said it was.
 *
 *   bun tools/trials/claude-ai/report.ts <calls.jsonl>
 */
import { summarizeCalls } from "../../../src/adapters/remote/call-log.js";

const path = process.argv[2];
if (path === undefined) {
  process.stderr.write("usage: report.ts <calls.jsonl>\n");
  process.exit(2);
}
const rows = summarizeCalls(path);
if (rows.length === 0) {
  process.stdout.write(`No calls logged yet at ${path}.\n`);
  process.exit(0);
}
const clients = [...new Set(rows.map((r) => r.client).filter((c): c is string => c !== null))];
process.stdout.write(`Client names seen at initialize: ${clients.length === 0 ? "(none)" : clients.join(", ")}\n\n`);
process.stdout.write("first seen (UTC)          calls  wake first  remembers  errors  tools\n");
for (const r of rows) {
  if (r.calls === 0) continue;
  process.stdout.write(
    `${r.firstAt.slice(0, 19).padEnd(24)}  ${String(r.calls).padStart(5)}  ${(r.wokeFirst ? "yes" : r.woke ? "later" : "no").padEnd(10)}  ${String(r.remembered).padStart(9)}  ${String(r.errors).padStart(6)}  ${r.tools.join(" ")}\n`,
  );
}
const withCalls = rows.filter((r) => r.calls > 0);
const woke = withCalls.filter((r) => r.wokeFirst).length;
process.stdout.write(`\n${String(withCalls.length)} connections with tool calls; wake first in ${String(woke)}. (No tool call at all leaves no row here: count those chats by hand.)\n`);
