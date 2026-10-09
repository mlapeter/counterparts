/**
 * THE HOST'S CUT (2026-10-09). Claude Code keeps two copies of each MCP tool
 * description: the first 2,048 characters, and the first 16,384. A tool loaded
 * through tool search gets the long copy; a tool loaded up front gets the short
 * one — with `ENABLE_TOOL_SEARCH=false`, behind a custom base URL or proxy, on a
 * model without tool search, or for an always-loaded tool (measured in the
 * 2.1.295 binary by the review of #328, and still so in 2.1.296). The field
 * descriptions in the input schema are served whole either way.
 *
 * So what a model needs to call a tool correctly has to sit in the first 2,048
 * characters: what it is for, when to call it, every "Do NOT", and the claims
 * that say how to call it. `renderDescription` puts the first three before the
 * guarantees list; each list leads with the fourth. These tests hold both, and
 * record each description's length so growth shows in review.
 *
 * Pure: renders the registry, opens no store.
 */
import { describe, expect, test } from "bun:test";

import { DESKTOP_TOOLS, TOOLS, renderDescription, toolDefinitions } from "../src/adapters/mcp/tools.js";
import type { ToolSpec } from "../src/adapters/mcp/tools.js";

/** What Claude Code serves of a description when the tool is loaded up front. */
const HOST_DESCRIPTION_CAP = 2_048;
/** Where `renderDescription`'s guarantees list begins. */
const GUARANTEES = "What this tool guarantees";

/** Where `part` ends in `text`; -1 when it is not there whole. */
function endOf(text: string, part: string): number {
  const at = text.indexOf(part);
  return at < 0 ? -1 : at + part.length;
}

/** The descriptions a client is actually sent, by tool name. */
function served(desktop: boolean): Map<string, string> {
  return new Map(toolDefinitions(desktop).map((t) => [String(t["name"]), String(t["description"])]));
}

describe("tool descriptions, as a host that serves only the first 2,048 characters shows them", () => {
  test("every tool's summary, When: line and each Do NOT line sit whole inside the cut, before the guarantees", () => {
    const failures: string[] = [];
    for (const [desktop, specs] of [
      [false, TOOLS],
      [true, DESKTOP_TOOLS],
    ] as const) {
      const descriptions = served(desktop);
      for (const spec of specs as readonly ToolSpec[]) {
        const description = descriptions.get(spec.name) ?? "";
        expect(description).toBe(renderDescription(spec));
        const list = description.indexOf(GUARANTEES);
        expect(list).toBeGreaterThan(0);
        if (!description.startsWith(spec.summary)) failures.push(`${spec.name}: the summary does not open the description`);
        for (const part of [`When: ${spec.admission}`, ...spec.negativeExamples]) {
          const end = endOf(description, part);
          if (end < 0) failures.push(`${spec.name}: missing "${part.slice(0, 50)}…"`);
          else if (end > HOST_DESCRIPTION_CAP) failures.push(`${spec.name}: "${part.slice(0, 50)}…" ends at ${String(end)}, past the cut`);
          else if (end > list) failures.push(`${spec.name}: "${part.slice(0, 50)}…" comes after the guarantees list`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * The claims each tool leads its guarantees with because they say how to
   * call it — each named by how it begins, and each held whole inside the cut.
   * Not listed: `status`, `scope` and `wake`, which are served whole; `dream`,
   * where no claim fits in the 179 characters left (its `begin` prompt states
   * the limits a dreamer needs); and the rest of every list, which a host that
   * loads the tool up front cuts.
   */
  const LEADS: Readonly<Record<string, readonly string[]>> = {
    note: [
      "`updates` is a FIELD",
      "`eventDate` is a FIELD",
      "A salience you claim is a FLOOR",
      "Claim nothing and this still counts",
      "You may score the three dimensions",
      "A stub is refused",
    ],
    recall: ["A question needs mode", "A handle expands exactly that memory", "Pass ids to read those memories whole"],
    session_end: [
      "It is bound to ONE session",
      "`updates` is a FIELD on an entry",
      "A salience you claim is a floor",
      "An entry that claims no salience",
      "An EMPTY `memories` array is a real answer",
    ],
    chapter: [
      "It is bound to ONE session exactly as `session_end` is",
      "The chapter number comes back from what was actually WRITTEN",
      "A second call inside the same chapter continues it",
      "The episode becomes MEMORY only through ordinary ingestion",
      "`about` is carried to the chapter's memory copy",
    ],
    self_page: ["It writes ONE row, kept with its versions"],
    reflect: [
      "It is bound to ONE session as `dream` is",
      "It is shown only what could surface in this session anyway",
      "`settle` settles two memories it was shown",
    ],
  };

  test("each tool's how-to-call claims lead its guarantees, whole inside the cut", () => {
    const failures: string[] = [];
    for (const [name, leads] of Object.entries(LEADS)) {
      const spec = TOOLS.find((t) => t.name === name);
      expect(spec).toBeDefined();
      const description = renderDescription(spec!);
      for (const lead of leads) {
        const claims = spec!.privileges.filter((p) => p.claim.startsWith(lead));
        if (claims.length !== 1) {
          failures.push(`${name}: ${String(claims.length)} claims begin "${lead}" (reworded? update LEADS)`);
          continue;
        }
        const end = endOf(description, `- ${claims[0]!.claim}`);
        if (end < 0 || end > HOST_DESCRIPTION_CAP) {
          failures.push(`${name}: "${lead}…" ends at ${String(end)}, past the ${String(HOST_DESCRIPTION_CAP)}-character cut`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * THE LENGTHS, RECORDED. When this fails because a description changed,
   * update the numbers: the diff is the record of the growth. `beforeList` is
   * the summary, the When: line and the Do NOT lines; past 2,048 in `total`, the
   * tail is what a host that loads the tool up front cuts.
   */
  test("each description's length is recorded, so a change shows in review", () => {
    const lengths = Object.fromEntries(
      DESKTOP_TOOLS.map((spec) => {
        const description = renderDescription(spec);
        return [spec.name, { total: description.length, beforeList: description.indexOf(GUARANTEES) }];
      }),
    );
    expect(lengths).toEqual({
      note: { total: 5091, beforeList: 951 },
      recall: { total: 6263, beforeList: 1200 },
      status: { total: 1212, beforeList: 501 },
      session_end: { total: 7218, beforeList: 811 },
      chapter: { total: 2097, beforeList: 746 },
      scope: { total: 1510, beforeList: 751 },
      self_page: { total: 4522, beforeList: 1737 },
      dream: { total: 3785, beforeList: 1782 },
      reflect: { total: 2815, beforeList: 1331 },
      wake: { total: 1958, beforeList: 1229 },
    });
  });
});
