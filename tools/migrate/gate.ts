/**
 * `tools/migrate/gate.ts` — the import path's chokepoint (CONTRACT §5 G1).
 *
 * THE SCAR THIS FILE IS PAID FOR: v1's secrets gate worked on the steady-state
 * path and its MIGRATION PATH BYPASSED IT — three live Google API keys landed in
 * the store across 17 traces (`docs/harvest/test-triage.md`; encode/secrets.ts's
 * `google-api-key` family is that key's own shape). *A bulk-import path is
 * secrets-gated exactly like any other write path.*
 *
 * So every body that could become canonical in v2 crosses `gateProposal()` here,
 * and nothing else in this tool may call `store.put` with text that did not come
 * back from this function. Two deliberate choices, both stated in the contract:
 *
 *   1. **The span IS the body.** `hedgePrecision` softens specifics that do not
 *      appear in the span the proposal was written from; handing it the body as
 *      its own span means every specific is sourced and nothing is hedged. An
 *      import is not an authorship claim, and this tool must not rewrite the
 *      owner's sentences — the ONLY edit it may make to prose is the gate's own
 *      redaction, which is counted.
 *   2. **v1 aliases do not go through the battery's alias gate.** That gate drops
 *      any alias not verbatim in the span, and v1's aliases are gazetteer cues
 *      that frequently are not in the body they index — routing them through it
 *      would silently strip legitimate retrieval keys. They are scanned for
 *      credentials individually instead (`scanName` below): the ops rule holds —
 *      a credential never becomes something the store indexes — without the
 *      verbatim rule that belongs to authorship.
 */
import {
  computeNovelty,
  containsSecret,
  gateProposal,
} from "../../src/core/encode/index.js";
import type { GateRecord, SecretFinding, SecretsGateRecord } from "../../src/core/encode/index.js";
import type { Kind } from "../../src/core/types.js";

export interface GateRequest {
  /** The source prose. Becomes its own span (see the header). */
  text: string;
  kind: Kind;
  /** A source address for telemetry: `<relPath>#<v1 id>`. Never body text. */
  ref: string;
  /** The title, when there is one. Rides as a handle so the ops rule runs on it. */
  title?: string;
}

export interface GateOutcome {
  ok: boolean;
  /** The gate's text — what may become canonical. Empty when refused. */
  text: string;
  /** True when the gate CHANGED the text (a redaction landed). */
  redacted: boolean;
  /** Family + count + site. Never the credential, never a hash of one. */
  findings: SecretFinding[];
  /** On refusal: every blocking reason, in the battery's own vocabulary. */
  blockedBy: string[];
  /** The title, dropped when it carried a credential shape. */
  title: string | undefined;
  titleDropped: boolean;
}

function secretsRecord(records: readonly GateRecord[]): SecretsGateRecord | undefined {
  return records.find((r): r is SecretsGateRecord => r.gate === "secrets");
}

/**
 * Gate one body. The battery runs all five checks whatever happens, so a refusal
 * carries every reason rather than the first one that fired.
 */
export function gateBody(req: GateRequest): GateOutcome {
  // The ops rule, pre-checked: a title carrying a credential shape is DROPPED
  // (and counted) rather than allowed to reject the whole body, which would
  // throw away the memory to punish its label. What remains goes to the battery
  // as a handle, so the rule still fires there for everything else.
  const titleDirty = req.title !== undefined && containsSecret(req.title);
  const title = titleDirty ? undefined : req.title;

  const outcome = gateProposal({
    proposal: {
      ref: req.ref,
      content: req.text,
      kind: req.kind,
      ...(title === undefined ? {} : { title, handles: [title] }),
    },
    span: req.text,
    // No vectors cross this seam: novelty is null-with-reason, never a default
    // (scar §2.9). A migrated memory is a blind encoding and says so.
    novelty: computeNovelty(null, []),
  });

  const g = outcome.gated;
  const findings = secretsRecord(g.records)?.findings ?? [];
  if (!g.accepted) {
    return {
      ok: false,
      text: "",
      redacted: findings.length > 0,
      findings,
      blockedBy: [...g.blockedBy],
      title,
      titleDropped: titleDirty,
    };
  }
  return {
    ok: true,
    text: g.content,
    redacted: g.content !== req.text,
    findings,
    blockedBy: [],
    title,
    titleDropped: titleDirty,
  };
}

/** One alias / handle / entity name: kept, or dropped for carrying a credential. */
export function scanName(name: string): { keep: boolean } {
  return { keep: name.trim().length > 0 && !containsSecret(name) };
}
