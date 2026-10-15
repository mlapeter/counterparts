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
    // THE PIN MOVED (2026-10-10, Group 1c). 01 C1's summary, admission and
    // negatives, verbatim, plus f8's "in the moment, as things catch your
    // attention", take 1,387 characters before the list (951 before), so three
    // how-to-call claims fit, not six. The three that left are each said on a
    // field the host serves whole: the default floor on `salience` ("A floor:
    // unset, a default by what it is about applies"), the dimensions on their
    // own fields, and a stub is refused by name when it is sent. Decided by
    // g1c-builder, 2026-10-10, lightly held; revisit after ~5 lived days. Why:
    // the brief's words are verbatim unless a measured limit forces a change,
    // and the limit here binds the privileges, not the words that invite.
    remember: ["`updates` is a FIELD", "`eventDate` is a FIELD", "A salience you claim is a FLOOR"],
    // The faded line joined the cut on 2026-10-10 (inline faded matches): a
    // model that reads only the start must know a faded result is shown, labeled.
    recall: ["A question needs mode", "A handle expands exactly that memory", "Pass ids to read those memories whole", "In facts mode a faded match"],
    session_end: [
      "It is bound to ONE session",
      "`updates` is a FIELD on an entry",
      "A salience you claim is a floor",
      "An entry that claims no salience",
      // "An EMPTY `memories` array is a real answer" left the cut on
      // 2026-10-10 (the head grew from 811 to 1,088 with 01 C1's text); the
      // `memories` field says it, served whole: "`[]` only when nothing
      // happened since you last wrote".
    ],
    chapter: [
      "It is bound to ONE session exactly as `session_end` is",
      "The chapter number comes back from what was actually WRITTEN",
      "A second call inside the same chapter continues it",
      "Each chapter has ONE summary memory, written once",
      "`about` is carried to this chapter's summary",
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

  // The chapter wording (2026-10-11): a diary of what happened, the details
  // kept, lessons left to the nightly reflection. The `text` field is served
  // whole; the summary and the Do NOT line sit inside the cut (held above).
  test("chapter asks for a diary of what happened and leaves lessons to the nightly reflection", () => {
    const spec = TOOLS.find((t) => t.name === "chapter")!;
    const text = String((spec.inputSchema["properties"] as Record<string, { description: string }>)["text"]!.description);
    for (const phrase of [
      "the way a person keeps a diary of their day",
      "what was said (exact words when they matter)",
      "what was decided and why",
      "Keep a list, a table or a pasted text word for word when its specifics matter.",
      "Leave out what the repo, the PR or the logs already hold",
      "lessons and patterns belong to the nightly reflection",
      "a quiet hour is a few lines",
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
      // `note` became `remember` on 2026-10-10 (Group 1c, 01 C1's text): the
      // head grew from 951 to 1,387 and session_end's from 811 to 1,088, both
      // well inside the cut with their leading claims.
      // +227 on 2026-10-11 (about-marks): the `remark` claim, last in the
      // list, past the cut; the field's own description is served whole.
      // THE TRIM (2026-10-11, the context-trims lane): the claims that change
      // nothing the model writes or calls moved to each tool's `engine` rows,
      // audited and not served — remember 5,839 → 2,533, recall 6,163 → 4,645,
      // session_end 7,825 → 2,485, chapter 2,417 → 1,778 (now whole inside the
      // cut). The heads are untouched.
      remember: { total: 2533, beforeList: 1387 },
      // session_end and chapter grew by 305 each on 2026-10-11: the `drewOn`
      // claim, last in each list (an engine row since the trim; the field says it).
      recall: { total: 4645, beforeList: 1200 },
      status: { total: 1212, beforeList: 501 },
      session_end: { total: 2485, beforeList: 1088 },
      // chapter +33 on 2026-10-11 (chapter wording): "a diary of what
      // happened" in the summary and the diary-vs-log Do NOT line. The
      // `about` claim, last of its leads, ends at 1,778, the description's end.
      // +188 on 2026-10-15 (chapter summaries): the summary claim replaces the
      // ingestion one; the `about` claim still ends inside the cut, at 1,966.
      chapter: { total: 1966, beforeList: 761 },
      scope: { total: 1514, beforeList: 755 },
      self_page: { total: 4846, beforeList: 1772 },
      // +18 on 2026-10-12 (onboarding round 1): the `undo` phase, said ("undo that dream").
      dream: { total: 3787, beforeList: 1782 },
      reflect: { total: 2808, beforeList: 1331 },
      // `meet` (2026-10-11): kept short on purpose — its script is its result.
      meet: { total: 459, beforeList: 210 },
      wake: { total: 1958, beforeList: 1229 },
    });
  });
});
