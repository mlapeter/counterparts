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
  /**
   * Redact every OTHER occurrence of a value this pattern captured, anywhere in
   * the text. For a credential caught by its context — a name, a nearby key id
   * — whose second copy has no context of its own (PR #189 review, M3).
   */
  propagate?: boolean;
  /** Why this family exists — lineage where there is any. */
  why: string;
}

/** Never match a placeholder we already wrote. */
const NOT_REDACTED = "(?!\\[REDACTED:)";

/**
 * The URL scheme's tail, BOUNDED. `[a-z][a-z0-9+.-]*://` retried at every word
 * boundary of a long hyphen- or dot-rich lowercase run is O(n²): the star eats
 * to the end of the run and backtracks looking for `://` from each start —
 * measured 744ms at 32KB, ~3s at 64KB, minutes at 512KB, inside the one gate
 * that has no off switch (replay review 2026-08-26, PR-1 follow-up; parallel-run
 * precondition §5.3). No registered URI scheme is longer than 32 characters,
 * so the bound changes what the family matches for no real URL.
 */
const SCHEME_TAIL = "[a-z0-9+.-]{0,32}";
/**
 * An AWS secret access key's SHAPE: exactly 40 characters of base64's alphabet,
 * fenced by lookarounds (`/`, `+` and `=` are not word characters, so `\b` would
 * not fence it), carrying at least one upper- and one lower-case letter. Only
 * ever used beside a context anchor — never on its own.
 *
 * Two kinds of PATH are not taken for one even beside a key id (review m8): a
 * run straight after `~` or `.` (`~/…`, `./…`, the path after a host name), and
 * a run that starts at a well-known absolute root (`/Users/…`, `/home/…`). A
 * secret that begins with one of those roots is a one-in-64⁶ event; a bare
 * leading `/` is NOT excluded, because one real secret in 64 begins with one.
 */
const AWS_SECRET_SHAPE =
  "(?<![A-Za-z0-9/+=~.])" +
  NOT_REDACTED +
  "(?!/(?:Users|home|usr|var|tmp|opt|etc|private|Volumes|mnt|srv|root|Library|Applications|System)/)" +
  "(?=[A-Za-z0-9/+=]{0,39}[A-Z])(?=[A-Za-z0-9/+=]{0,39}[a-z])(?=[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=]))";
const AWS_SECRET_TOKEN_AFTER_ID =
  AWS_SECRET_SHAPE + "(?<=\\[REDACTED:aws-access-key-id\\][\\s\\S]{0,200})([A-Za-z0-9/+=]{40})";
const AWS_SECRET_TOKEN_BEFORE_ID =
  AWS_SECRET_SHAPE + "([A-Za-z0-9/+=]{40})(?=[\\s\\S]{0,200}\\[REDACTED:aws-access-key-id\\])";

/**
 * A value that is a small number, a boolean or a null word is a SETTING, not a
 * credential — `TOKEN_LIMIT: "4096"`, `SECRET="false"` — and is left alone by
 * the catch-all below. Six digits or more under a password-shaped name is still
 * redacted: a numeric password or a PIN is a credential.
 */
const NOT_A_PLAIN_VALUE =
  "(?![\"']?(?:\\d{1,5}|true|false|null|none|nil|yes|no|on|off|undefined)[\"']?(?![^\\s,;}\\])]))";
// The same lever exists one class later in `url-path-token`: an unbounded
// host/path run (`[^\s"'<>]*`) retried across a comma-joined URL list was
// quadratic too (179ms at 64KB, 2.8s at 256KB — PR-8 review). Bounded to 512:
// longer than any real magic-link path, and a single oversized span can be its
// own chunk, so the input size is not otherwise capped before the gate.

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
  // THE OTHER HALF OF THE PAIR (handoff INTERFACE-GAPS §6, the 2026-09-20
  // review): the id above was redacted and the SECRET beside it was stored
  // verbatim, in a handoff, and in the journal and the self page by the same
  // battery. The secret has no prefix — it is 40 characters of base64's
  // alphabet — so its SHAPE alone would also match a CamelCase identifier or a
  // path, and a bare-shape family is a declared non-goal (encode NOTES, item 18).
  // It is caught by CONTEXT, three ways, and all three share one family name
  // because they are one credential. Every value any of them captures is then
  // redacted EVERYWHERE it appears in the text (`propagate`): one verbatim copy
  // further down is the whole leak (PR #189 review, M3).
  {
    family: "aws-secret-access-key",
    // 1. NAMED: `aws_secret_access_key = …`, `AWS_SECRET_ACCESS_KEY=…`, the JSON
    //    `"SecretAccessKey": "…"`, `aws configure`'s `AWS Secret Access Key
    //    [None]: …`, and the four forms with no `=` beside the name (review M4):
    //    `aws configure set aws_secret_access_key …`, a Dockerfile's `ENV
    //    AWS_SECRET_ACCESS_KEY …`, `os.environ["AWS_SECRET_ACCESS_KEY"] = "…"`,
    //    and STS/IAM XML `<SecretAccessKey>…`. Keeps the name, redacts the value
    //    — the ops rule. The VALUE must carry a digit, `/` or `+` as well as a
    //    letter, so the word after the name in prose ("SecretAccessKey:
    //    ConfigurationDocumentation…") is not taken for one (review m8).
    //    Fenced by "no letter or digit before", not `\b`, so a prefixed name
    //    (`MY_AWS_SECRET_ACCESS_KEY`) is still a name.
    re: new RegExp(
      "(?<![A-Za-z0-9])((?:aws[_ \\t-]?secret[_ \\t-]?(?:access[_ \\t-]?)?key|secret[_ \\t-]?access[_ \\t-]?key)" +
        "(?:[ \\t]*\\[[^\\]\\n]{0,24}\\])?" +
        "(?:[\"']?\\]?[ \\t]*[:=>][ \\t]*[\"']?|[\"']?[ \\t]+[\"']?))" +
        NOT_REDACTED +
        "((?=[A-Za-z0-9/+=]{0,200}?[0-9/+])(?=[A-Za-z0-9/+=]{0,200}?[A-Za-z])[A-Za-z0-9/+=]{16,})",
      "gi",
    ),
    value: 2,
    propagate: true,
    why: "An AWS secret access key under its own name (env, credentials file, CLI, Dockerfile, code, JSON, XML).",
  },
  {
    family: "aws-secret-access-key",
    // 2. AFTER A KEY ID, within 200 characters: the 09-20 review's own shape,
    //    "…AKIA… and the secret wJalr…". Anchored on the id's PLACEHOLDER, which
    //    the key-id family has already written by the time this runs — so text
    //    an older build redacted half of is finished by a re-scan. The anchor is
    //    a LOOKBEHIND, not part of the match: one id cannot be used up by the
    //    first token after it, so a second copy, an old and a new secret, and
    //    two ids followed by two secrets are all taken (review M3).
    re: new RegExp(AWS_SECRET_TOKEN_AFTER_ID, "g"),
    value: 1,
    propagate: true,
    why: "An AWS secret access key written after its key id.",
  },
  {
    family: "aws-secret-access-key",
    // 3. BEFORE A KEY ID, within 200 characters — the same pair, the other way
    //    round ("secret wJalr…, id AKIA…"), with the anchor a LOOKAHEAD for the
    //    same reason.
    re: new RegExp(AWS_SECRET_TOKEN_BEFORE_ID, "g"),
    value: 1,
    propagate: true,
    why: "An AWS secret access key written before its key id.",
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
      `\\b([a-z]${SCHEME_TAIL}://[^\\s/:@]+):${NOT_REDACTED}([^\\s/@]+)@`,
      "gi",
    ),
    value: 2,
    why: "user:password@host — connection strings are the classic silent leak.",
  },
  {
    family: "url-path-token",
    re: new RegExp(
      `\\b[a-z]${SCHEME_TAIL}://[^\\s"'<>]{0,512}/` +
        "(?:login|logout|auth|magic|magic-?link|token|invite|reset|verify|otp|signin|sso|session)" +
        // One optional lowercase segment ("auth/callback/<token>") — but the
        // auth-shaped word itself is never optional. The second lookahead
        // rejects a pure lowercase hyphen-slug ("getting-started-guide"): a
        // token has digits or case or underscores; a slug is words. Without it
        // this family redacted the last path segment of ordinary docs URLs —
        // the PR-1 review's blocker 1, caught with 11 live counterexamples.
        `[a-z-]*(?:/[a-z-]{1,24})?/${NOT_REDACTED}` +
        "(?![a-z]+(?:-[a-z]+)*(?![A-Za-z0-9_~-]))" +
        "([A-Za-z0-9_~-]{12,})(?![A-Za-z0-9_~-])",
      "gi",
    ),
    value: 1,
    why:
      "A magic-login / invite / reset link carries its bearer token as a URL path " +
      "segment. The 2026-08-26 replay review found a live staff login link minted " +
      "whole (its Gap A: `url-credentials` only matches user:pass@host). Scoped to " +
      "auth-shaped path words so a commit hash in a repo URL does not fire it.",
  },
  {
    family: "assigned-credential",
    // FENCED BY "NO LETTER OR DIGIT BEFORE", NOT `\b` (PR #189 review, M5). An
    // underscore is a word character, so `\b` never fired inside a snake_case
    // name and `DB_PASSWORD=…`, `JWT_SECRET=…`, `AWS_SESSION_TOKEN=…` and
    // `HF_TOKEN=…` were stored verbatim through every entrance. The TRAILING
    // `\b` stays, and it is the false-positive guard: `MAX_TOKENS`,
    // `TOKEN_URL`, `SECRET_ROTATION_DAYS` do not end in the keyword, so they
    // never match. A closing quote may sit between the name and the `:` — the
    // JSON form (`"SessionToken": "…"`) — and a small number or a boolean is a
    // setting, not a credential (`NOT_A_PLAIN_VALUE`).
    re: new RegExp(
      "(?<![A-Za-z0-9])(password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|" +
        "client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|" +
        "bearer[_-]?token|secret|token|credential)\\b[\"']?\\s*[:=]\\s*" +
        // A QUOTED placeholder is still a placeholder: without the optional quote
        // a re-scan re-redacted `KEY="[REDACTED:…]"`, and once the fence let this
        // family reach `ACCESS_KEY` inside `AWS_SECRET_ACCESS_KEY`, it took the
        // AWS family's own mark for a value.
        "(?![\"']?\\[REDACTED:)" +
        NOT_A_PLAIN_VALUE +
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

function redactOne(
  text: string,
  p: SecretPattern,
  hit: () => void,
  captured?: (value: string) => void,
): string {
  // A fresh regex per call: a module-level /g regex carries `lastIndex` state,
  // and a shared mutable cursor across callers is a bug waiting for a Tuesday.
  const re = new RegExp(p.re.source, p.re.flags);
  return text.replace(re, (...args: unknown[]): string => {
    const match = String(args[0] ?? "");
    hit();
    const mark = `[REDACTED:${p.family}]`;
    if (p.value === 0) {
      captured?.(match);
      return mark;
    }
    const raw = args[p.value];
    const val = typeof raw === "string" ? raw : "";
    if (val.length === 0) return mark;
    captured?.(val);
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
  const bump = (family: string): void => {
    counts.set(family, (counts.get(family) ?? 0) + 1);
  };
  // Values a `propagate` pattern captured, by family. Never logged, never
  // hashed — they live for the length of this call and leave only as marks.
  const spread = new Map<string, Set<string>>();
  let out = text;
  for (const p of SECRET_FAMILIES) {
    out = redactOne(
      out,
      p,
      () => bump(p.family),
      p.propagate === true
        ? (value) => {
            const set = spread.get(p.family) ?? new Set<string>();
            set.add(value);
            spread.set(p.family, set);
          }
        : undefined,
    );
  }
  // EVERY COPY, NOT THE FIRST ONE (review M3). A value caught by its context is
  // taken out wherever else it stands. ONE linear pass over the text's maximal
  // base64 runs with a set lookup — never a regex per value, which on a text of
  // a thousand pairs would be a thousand passes. Every propagating family
  // captures a maximal run (greedy, or fenced), so an exact run match is the
  // same value and a longer token that merely contains it is left alone.
  // Sixteen characters at least, so no common word can ever be propagated.
  if (spread.size > 0) {
    const familyOf = new Map<string, string>();
    for (const [family, values] of spread) {
      for (const value of values) if (value.length >= 16) familyOf.set(value, family);
    }
    if (familyOf.size > 0) {
      out = out.replace(/(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{16,}(?![A-Za-z0-9/+=])/g, (run) => {
        const family = familyOf.get(run);
        if (family === undefined) return run;
        bump(family);
        return `[REDACTED:${family}]`;
      });
    }
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
