/**
 * A MEMORY ABOUT THIS SYSTEM'S OWN PLUMBING (2026-11-04, TC1) — a memory
 * whose SUBJECT is a refused or denied tool call, a declined permission
 * prompt, or what the session it was written in could not do (no such tool,
 * a slash command it cannot run). Seen twice live: in Dana's week (11-03) and
 * the developer week (11-04) the session wrote "Morning share told to Theo but
 * reflect 'told' call was permission-denied", dated and marked `us`, and it
 * led Coming up in every folder for the rest of the week.
 *
 * Not a filter on what is kept: the memory still lands. What its subject
 * cannot claim is the standing a life event has — a date that comes back, an
 * open thread, a mark that it is about me or about us (`counterpart-deposit.ts`
 * applies it, the door says so). The person's own words about a prompt are
 * theirs (WP1's rule): `saidBy: owner` is never read as plumbing.
 *
 * WHAT IS READ: the subject only — the title, or the text's first line when
 * there is no title — never the whole body. A real memory may mention a
 * refusal in passing ("deadline Friday; I couldn't set the reminder") and
 * keeps its date; one whose headline IS the refusal does not. And only this
 * system's own vocabulary: a work fact about a refusal ("deploy failed:
 * permission denied on /var/log", "the API call was rejected with 429") names
 * no tool call, prompt or mark, and is not read as one.
 *
 * Pure: no store, no clock. The cue it returns is the pattern's name, for the
 * row's meta and the door's note.
 */

/** The meta key a plumbing memory carries, with the cue that read it so (`own-plumbing.ts`). */
export const OWN_PLUMBING_META_KEY = "ownPlumbing";

export type OwnPlumbingCue = "permission" | "tool-refused" | "tool-not-granted" | "slash-command" | "session-tools";

const REFUSED = /\b(?:denied|blocked|refused|declined|rejected|disallowed)\b/i;

/** Ordered: the first that reads the subject names the cue. */
const CUES: readonly { readonly cue: OwnPlumbingCue; readonly reads: (s: string) => boolean }[] = [
  // A permission prompt or request refused, for a call, a tool, a prompt or a mark
  // ("reflect 'told' call was permission-denied", "declined permission to mark a note delivered").
  { cue: "permission", reads: (s) => /\bpermission/i.test(s) && REFUSED.test(s) && /\b(?:tools?|calls?|prompts?|mark(?:ed|ing)?|counterparts|mcp__\w+)\b/i.test(s) },
  // A tool's call refused, by the tool's own name or the word ("the Bash tool call was denied", "mcp__counterparts__reflect was blocked").
  {
    cue: "tool-refused",
    reads: (s) =>
      /\btool(?:[- ]calls?|s)?\b[^.;\n]{0,30}?\b(?:was|were|got|is|are|been)\s+(?:permission[- ])?(?:denied|blocked|refused|declined|rejected|disallowed)\b/i.test(s) ||
      (/\bmcp__\w+/i.test(s) && REFUSED.test(s)),
  },
  // A tool this session isn't allowed ("the reflect tool isn't granted here").
  { cue: "tool-not-granted", reads: (s) => /\btools?\b[^.;\n]{0,30}?\b(?:isn't|is not|wasn't|was not|aren't|are not|weren't|were not|not)\s+(?:granted|allowed|permitted)\b/i.test(s) },
  // A slash command the session cannot run ("/loop is a slash command, so I couldn't").
  { cue: "slash-command", reads: (s) => /\bis a slash command\b/i.test(s) || (/\bslash commands?\b/i.test(s) && /\b(?:couldn't|could not|can't|cannot|unable)\b/i.test(s)) },
  // What tools the session had ("that session had only memory tools").
  { cue: "session-tools", reads: (s) => /\bonly (?:had |has |have )?(?:the )?(?:memory|counterparts) tools\b/i.test(s) || /\b(?:had|has|have) no (?:file|shell|bash|edit(?:ing)?) tools?\b/i.test(s) },
];

/** The subject a memory is read by: its title, else its text's first line. */
export function subjectOf(title: string | null | undefined, content: string): string {
  const t = (title ?? "").trim();
  if (t.length > 0) return t;
  return (content.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
}

/**
 * The cue that reads this memory's subject as this system's own plumbing, or
 * null. `saidBy: owner` is always null: the person's words are theirs.
 */
export function ownPlumbingCue(input: { readonly title: string | null | undefined; readonly content: string; readonly saidBy?: string | null }): OwnPlumbingCue | null {
  if (input.saidBy === "owner") return null;
  const subject = subjectOf(input.title, input.content);
  if (subject.length === 0) return null;
  for (const c of CUES) if (c.reads(subject)) return c.cue;
  return null;
}

/** What the door says beside a memory the gate read as plumbing (`mcp/server-args.ts#ownPlumbingEcho`). */
export const OWN_PLUMBING_NOTE =
  "Kept, but its subject is this memory system's own plumbing (a refused tool call, a permission prompt, what this session can't do), so it carries no date, no open thread and no me/us mark. That isn't something that happened between you and them: next time write what they wanted instead, or nothing.";
