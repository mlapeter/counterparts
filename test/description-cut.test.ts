/**
 * THE HOST'S CUT (2026-10-09; limits restated 2026-11-13). Claude Code keeps
 * two copies of each MCP tool description: a short one and the first 16,384
 * characters. A tool loaded through tool search gets the long copy; a tool
 * loaded up front gets the short one — with `ENABLE_TOOL_SEARCH=false`, behind
 * a custom base URL or proxy, on a model without tool search, or for an
 * always-loaded tool. The short copy is 4,096 characters from 2.1.296 (read in
 * the 2.1.323 binary, review of #816: 4,096 up front, 16,384 through tool
 * search; the docs say "Before v2.1.296, the shorter limit was 2,048
 * characters"), and 2,048 on older clients (measured in the 2.1.295 binary by
 * the review of #328). The field descriptions in the input schema are served
 * whole either way.
 *
 * The tests below still hold what a model needs to call a tool correctly
 * inside the first 2,048 characters — what it is for, when to call it, every
 * "Do NOT", and the claims that say how to call it — so a client older than
 * 2.1.296 still gets the call-critical text. `renderDescription` puts the first
 * three before the guarantees list; each list leads with the fourth. A tool
 * marked to load up front (`ToolSpec.alwaysLoad`) is held at 4,096 whole, at
 * the end. These tests also record each description's length so growth shows
 * in review.
 *
 * Pure: renders the registry, opens no store.
 */
import { describe, expect, test } from "bun:test";

import { CLAUDE_AI_TOOLS, DESKTOP_TOOLS, TOOLS, renderDescription, servesAlwaysLoad, toolDefinitions, toolListFor } from "../src/adapters/mcp/tools.js";
import { CLAUDE_AI_HOST, DESKTOP_HOST } from "../src/adapters/hosts.js";
import type { ToolSpec } from "../src/adapters/mcp/tools.js";

/** What Claude Code before 2.1.296 serves of a description loaded up front (4,096 since). Kept
 *  so older clients still get the call-critical text. */
const HOST_DESCRIPTION_CAP = 2_048;
/** Where `renderDescription`'s guarantees list begins. */
const GUARANTEES = "What this tool guarantees";

/** Where `part` ends in `text`; -1 when it is not there whole. */
function endOf(text: string, part: string): number {
  const at = text.indexOf(part);
  return at < 0 ? -1 : at + part.length;
}

/** The descriptions a client is actually sent, by tool name. */
function served(desktop: boolean | string): Map<string, string> {
  return new Map(toolDefinitions(desktop).map((t) => [String(t["name"]), String(t["description"])]));
}

describe("tool descriptions, as a host that serves only the first 2,048 characters shows them", () => {
  // TRIM PR 2 (2026-11-13): every tool but `recall` serves no guarantees list on any host — each
  // claim is an engine row, still audited (`mcp.test.ts`) — so the whole description is what must fit.
  // `recall` keeps its list until trim PR 3, and its call-critical text still leads it.
  test("every tool's summary, When: line and each Do NOT line sit whole inside the cut; only recall serves a guarantees list, after them", () => {
    const failures: string[] = [];
    for (const [desktop, specs] of [
      [false, TOOLS],
      [true, DESKTOP_TOOLS],
      [CLAUDE_AI_HOST, CLAUDE_AI_TOOLS],
    ] as const) {
      const descriptions = served(desktop);
      for (const spec of specs as readonly ToolSpec[]) {
        const description = descriptions.get(spec.name) ?? "";
        expect(description).toBe(renderDescription(spec));
        const listed = desktop !== CLAUDE_AI_HOST && spec.name === "recall";
        const list = listed ? description.indexOf(GUARANTEES) : description.length + 1;
        if (listed) expect(list).toBeGreaterThan(0);
        else {
          expect(description).not.toContain(GUARANTEES);
          if (description.length > HOST_DESCRIPTION_CAP) failures.push(`${spec.name}: ${String(description.length)} characters, past the cut`);
        }
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
   * The claims `recall` leads its guarantees with because they say how to call
   * it — each named by how it begins, and each held whole inside the cut. Since
   * trim PR 2 the other tools serve none (their claims are engine rows).
   */
  const LEADS: Readonly<Record<string, readonly string[]>> = {
    // The faded line joined the cut on 2026-10-10 (inline faded matches): a
    // model that reads only the start must know a faded result is shown, labeled.
    recall: ["A question needs mode", "A handle expands exactly that memory", "Pass ids to read those memories whole", "In facts mode a faded match"],
  };

  test("recall's how-to-call claims lead its guarantees, whole inside the cut; no other tool serves a claim", () => {
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
    for (const spec of [...TOOLS, ...DESKTOP_TOOLS, ...CLAUDE_AI_TOOLS]) {
      if (spec.name !== "recall") expect([spec.name, spec.privileges]).toEqual([spec.name, []]);
    }
  });

  // Review of #751 (TC1): `saidBy: owner` is the plumbing gate's exemption. Since trim PR 2 the
  // claim that said `saidBy` is a field is an engine row; the entry publishes the field itself, on
  // every host, beside the plumbing Do NOT.
  test("session_end's entry publishes saidBy (and occurredOn, status), and the plumbing Do NOT is served, on every host", () => {
    for (const host of [false, true, CLAUDE_AI_HOST]) {
      const def = toolDefinitions(host).find((t) => t["name"] === "session_end")!;
      const entry = (def["inputSchema"] as { properties: { memories: { items: { properties: Record<string, { enum?: string[] }> } } } }).properties.memories.items.properties;
      expect(entry["saidBy"]?.enum).toEqual(["owner", "self", "inferred"]);
      expect(entry["occurredOn"]).toBeDefined();
      expect(entry["status"]?.enum).toContain("planned");
      expect(String(def["description"])).toContain("Do NOT save refused calls unless the person raised it.");
    }
  });

  // Review of #379: the credit rule's first sentence sat inside the cut before
  // the faded claim joined the list ahead of it; the faded claim is kept short
  // so it still does.
  test("recall's credit rule opens inside the cut: being shown strengthens nothing", () => {
    const sentence = "A search strengthens nothing — a memory you were only shown in a list is no stronger for having been listed.";
    for (const desktop of [false, true]) {
      const end = endOf(served(desktop).get("recall") ?? "", sentence);
      expect(end).toBeGreaterThan(0);
      expect(end).toBeLessThanOrEqual(HOST_DESCRIPTION_CAP);
    }
  });

  // The chapter wording (2026-10-11; shortened in trim PR 2): a diary of what
  // happened, the details kept, lessons left to the nightly reflection.
  test("chapter asks for a diary of what happened and leaves lessons to the nightly reflection", () => {
    const spec = TOOLS.find((t) => t.name === "chapter")!;
    const text = String((spec.inputSchema["properties"] as Record<string, { description: string }>)["text"]!.description);
    for (const phrase of [
      "like a diary",
      "what was said (exact words when they matter)",
      "what was decided and why",
      "Skip what the repo or logs hold",
      "lessons are the night's",
      "A quiet hour is a few lines",
    ]) {
      expect(text).toContain(phrase);
    }
    const description = renderDescription(spec);
    expect(description).toContain("a diary of what happened");
    expect(description).toContain("Do NOT manufacture depth");
    expect(description).not.toContain("changelog");
    expect(`${description} ${text}`).not.toContain("what you learned");
  });

  /**
   * THE LENGTHS, RECORDED. When this fails because a description changed,
   * update the numbers: the diff is the record of the growth. `beforeList` is
   * the summary, the When: line and the Do NOT lines (-1: no list, the whole
   * description is that); past 2,048 in `total`, the tail is what a host that
   * loads the tool up front cuts.
   */
  test("each description's length is recorded, so a change shows in review", () => {
    const lengths = Object.fromEntries(
      // Every host's words (Claude Code's), and `wake`. Desktop's own `dream`
      // and `reflect` words (OL1d) are held inside the cut by the test above.
      [...TOOLS, ...DESKTOP_TOOLS.filter((t) => t.name === "wake")].map((spec) => {
        const description = renderDescription(spec);
        return [spec.name, { total: description.length, beforeList: description.indexOf(GUARANTEES) }];
      }),
    );
    expect(lengths).toEqual({
      // TRIM PR 2 (2026-11-13, the tool-trim design §7): every claim but recall's an engine row,
      // the words shortened — remember 2,533 → 741, status 1,289 → 240, session_end 2,540 → 602,
      // chapter 1,980 → 531, scope 1,795 → 414, self_page 4,909 → 720, dream 3,721 → 808,
      // reflect 3,704 → 764, meet 459 → 208, wake 1,963 → 384. Recall untouched (PR 3).
      remember: { total: 741, beforeList: -1 },
      // −760 on 2026-11-13 (loaded up front on Claude Code, `ToolSpec.alwaysLoad`):
      // the claims tightened to fit the 4,096 cut, the journal claim an engine
      // row (each answer glosses a chapter itself). The head is untouched.
      // +97 on 2026-11-13 (after #815): the time claim names ranges, the forward
      // words, reminder dates and the "also due" list; the line claim says "due".
      // +11 on the review of #817: "today or a window ahead", "with topic words".
      recall: { total: 3954, beforeList: 1200 },
      status: { total: 240, beforeList: -1 },
      session_end: { total: 602, beforeList: -1 },
      chapter: { total: 531, beforeList: -1 },
      scope: { total: 414, beforeList: -1 },
      self_page: { total: 720, beforeList: -1 },
      dream: { total: 808, beforeList: -1 },
      reflect: { total: 764, beforeList: -1 },
      // `meet` (2026-10-11): kept short on purpose — its script is its result.
      meet: { total: 208, beforeList: -1 },
      wake: { total: 384, beforeList: -1 },
    });
  });
});

/**
 * LOADED UP FRONT (2026-11-13, `ToolSpec.alwaysLoad`). Claude Code loads a tool
 * whose `tools/list` entry carries `_meta["anthropic/alwaysLoad"] === true` up
 * front (a server's config `alwaysLoad: false` overrides it), and from 2.1.296
 * cuts an up-front tool's description at 4,096 characters (read in the 2.1.323
 * binary). Older clients cut at 2,048; the tests above keep the call-critical
 * text inside that, and this one keeps a flagged tool whole at 4,096.
 */
describe("a tool loaded up front fits the up-front cut", () => {
  const UP_FRONT_CAP = 4_096;
  test("every flagged tool's rendered description is at most 4,096 characters, on every list that carries it", () => {
    const flagged = [...TOOLS, ...DESKTOP_TOOLS, ...CLAUDE_AI_TOOLS].filter((t) => t.alwaysLoad === true);
    expect(flagged.map((t) => t.name)).toContain("recall");
    for (const spec of flagged) expect(renderDescription(spec).length).toBeLessThanOrEqual(UP_FRONT_CAP);
  });

  test("the flag is sent by host: every host served Claude Code's list, and no other", () => {
    for (const host of [false, true, "", "claude-code", "some-other-host", DESKTOP_HOST, CLAUDE_AI_HOST]) {
      expect(servesAlwaysLoad(host)).toBe(toolListFor(host) === TOOLS);
      const flagged = toolDefinitions(host).filter((t) => "_meta" in t).map((t) => t["name"]);
      expect(flagged).toEqual(servesAlwaysLoad(host) ? ["recall"] : []);
    }
  });
});
