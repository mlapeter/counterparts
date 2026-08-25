/**
 * The secrets gate. THE NON-ABLATABLE ONE.
 *
 * CONTRACT §5 G1: no off switch, no A/B arm, no bypass. *A prompt is not exempt
 * from the gate.* Three things enforce that here, none of them a comment:
 *
 *   1. **No function in this file takes an options object.** There is no
 *      parameter that could carry a disable flag, so no caller can pass one.
 *   2. **`SecretsGateStatus` cannot spell `stood-down`** (types.ts) — the
 *      disabled state is not representable in the telemetry type.
 *   3. **Every text-returning export of `encode/` runs this scan on its OUTPUT**,
 *      regardless of call order, so a caller that reaches past the battery still
 *      cannot get an unredacted string out of the module.
 *
 * Brain analog: NONE. §2 of the contract names this the deliberate deviation —
 * the brain has no interlock that refuses to encode a credential.
 *
 * The incident this is paid for: v1's secrets gate worked on the steady-state
 * path and the MIGRATION PATH BYPASSED IT; three live Google API keys landed in
 * the store across 17 traces (scar §7a). The `google-api-key` family below is
 * that key's own shape.
 *
 * Telemetry rule: findings carry FAMILY and COUNT and nothing else. The secret is
 * never logged and never HASHED — a low-entropy credential's hash is reversible
 * (store §16 G9), so `hashText(secret)` would be the leak wearing a disguise.
 */

import type { SecretFinding } from "./types.js";

export const REDACTION_MARK = "[REDACTED:";

/** Matches a placeholder this module wrote. Used to keep redaction idempotent. */
export const REDACTION_RE = /\[REDACTED:[a-z0-9-]+\]/g;

export interface SecretPattern {
  family: string;
  re: RegExp;
  /** Which capture group holds the credential. 0 = the whole match. */
  value: number;
  /** Why this family exists — lineage where there is any. */
  why: string;
}

/** Never match a placeholder we already wrote. */
const NOT_REDACTED = "(?!\\[REDACTED:)";

/**
 * The families, in application order: block forms first, then prefixed vendor
 * keys (precise, no false positives), then the shape-based forms, then the
 * assignment form (broadest, and the only one that keeps its key name).
 *
 * [A] The LIST is a preference and will grow. That a scan EXISTS and runs on
 * every path is mechanized (§5 G12).
 */
export const SECRET_FAMILIES: readonly SecretPattern[] = [
  {
    family: "private-key-block",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    value: 0,
    why: "PEM/OpenSSH private key, whole block.",
  },
  {
    family: "private-key-header",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
    value: 0,
    why: "A truncated key block is still a key block: never let the header through.",
  },
  {
    family: "aws-access-key-id",
    re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
    value: 0,
    why: "AWS key id prefixes.",
  },
  {
    family: "google-api-key",
    // A live key is AIza + exactly 35, but an exact-length pattern misses a
    // truncated or typo'd paste — which is still a credential shape in the store.
    re: /\bAIza[0-9A-Za-z_-]{30,}/g,
    value: 0,
    why: "The v1 incident's own shape (scar §7a): 3 live keys, 17 traces.",
  },
  {
    family: "github-token",
    re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
    value: 0,
    why: "GitHub PAT / OAuth / refresh token prefixes.",
  },
  {
    family: "gitlab-token",
    re: /\bglpat-[A-Za-z0-9_-]{16,}/g,
    value: 0,
    why: "GitLab personal access token.",
  },
  {
    family: "npm-token",
    re: /\bnpm_[A-Za-z0-9]{30,}\b/g,
    value: 0,
    why: "npm automation token.",
  },
  {
    family: "slack-token",
    re: /\bxox[abprse]-[A-Za-z0-9-]{10,}/g,
    value: 0,
    why: "Slack bot/user/app tokens.",
  },
  {
    family: "stripe-key",
    re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
    value: 0,
    why: "Stripe secret/restricted keys.",
  },
  {
    family: "model-provider-key",
    re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,
    value: 0,
    why: "Anthropic / OpenAI style `sk-` keys.",
  },
  {
    family: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g,
    value: 0,
    why: "A signed JWT is a bearer credential.",
  },
  {
    family: "bearer-token",
    re: new RegExp(`\\bBearer\\s+${NOT_REDACTED}([A-Za-z0-9._~+/-]{16,}=*)`, "gi"),
    value: 1,
    why: "Authorization header pasted into a note.",
  },
  {
    family: "url-credentials",
    re: new RegExp(
      `\\b([a-z][a-z0-9+.-]*://[^\\s/:@]+):${NOT_REDACTED}([^\\s/@]+)@`,
      "gi",
    ),
    value: 2,
    why: "user:password@host — connection strings are the classic silent leak.",
  },
  {
    family: "assigned-credential",
    re: new RegExp(
      "\\b(password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|" +
        "client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|" +
        "bearer[_-]?token|secret|token|credential)\\b\\s*[:=]\\s*" +
        NOT_REDACTED +
        "(\"[^\"\\n]{4,}\"|'[^'\\n]{4,}'|[^\\s\"'\\n,;]{6,})",
      "gi",
    ),
    value: 2,
    why: "The catch-all assignment form. Keeps the KEY NAME, redacts only the value: a name is not a claim (§3, the ops rule).",
  },
];

export interface SecretsScan {
  /** The text with every credential replaced by `[REDACTED:family]`. */
  redacted: string;
  /** Family + count + site. Never the secret, never its hash. */
  findings: SecretFinding[];
  fired: boolean;
  /** True when nothing but redaction placeholders and punctuation remain. */
  emptyAfterRedaction: boolean;
}

function redactOne(text: string, p: SecretPattern, hit: () => void): string {
  // A fresh regex per call: a module-level /g regex carries `lastIndex` state,
  // and a shared mutable cursor across callers is a bug waiting for a Tuesday.
  const re = new RegExp(p.re.source, p.re.flags);
  return text.replace(re, (...args: unknown[]): string => {
    const match = String(args[0] ?? "");
    hit();
    const mark = `[REDACTED:${p.family}]`;
    if (p.value === 0) return mark;
    const raw = args[p.value];
    const val = typeof raw === "string" ? raw : "";
    if (val.length === 0) return mark;
    const at = match.lastIndexOf(val);
    if (at < 0) return mark;
    return `${match.slice(0, at)}${mark}${match.slice(at + val.length)}`;
  });
}

/** Everything this module wrote, removed — used to answer "is there anything left?". */
export function stripRedactions(text: string): string {
  return text.replace(new RegExp(REDACTION_RE.source, REDACTION_RE.flags), " ");
}

/**
 * THE scan. No options parameter, by design (see the header): there is nowhere
 * for a caller to put a disable flag.
 *
 * `site` is telemetry only — body, alias, handle, feeling, context — and can
 * never change the verdict.
 */
export function scanSecrets(text: string, site = "body"): SecretsScan {
  const counts = new Map<string, number>();
  let out = text;
  for (const p of SECRET_FAMILIES) {
    out = redactOne(out, p, () => counts.set(p.family, (counts.get(p.family) ?? 0) + 1));
  }
  const findings: SecretFinding[] = [...counts.entries()].map(([family, count]) => ({
    family,
    count,
    site,
  }));
  const residue = stripRedactions(out).replace(/[^\p{L}\p{N}]/gu, "");
  return {
    redacted: out,
    findings,
    fired: findings.length > 0,
    emptyAfterRedaction: findings.length > 0 && residue.length === 0,
  };
}

/**
 * The convenience form: redacted text, nothing else. Every text-returning export
 * of `encode/` funnels its output through this, so the gate is universal by
 * construction rather than by everyone remembering (scar §7).
 */
export function redactSecrets(text: string): string {
  return scanSecrets(text).redacted;
}

/** True when a string carries any credential shape at all. */
export function containsSecret(text: string): boolean {
  return scanSecrets(text).fired;
}
