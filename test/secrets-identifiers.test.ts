/**
 * RD1 — an identifier assigned to an identifier is not a credential.
 *
 * A developer-week run turned `pad_token = eos_token` into
 * `[REDACTED:assigned-credential]`. Researchers paste tokenizer code all day. The rule:
 * an unquoted, letters-only snake_case / camelCase word assigned to a non-password
 * credential-looking name is a code reference, not a value. Real secrets keep redacting.
 * Pure function, no store.
 */
import { describe, expect, test } from "bun:test";
import { containsSecret, redactSecrets } from "../src/core/encode/secrets.js";

const ORDINARY_CODE = [
  "pad_token = eos_token",
  "tokenizer.pad_token = tokenizer.eos_token",
  "tokenizer.pad_token = tokenizer.eos_token_id",
  'api_version = "2024-02-01"',
  'token_type_ids = inputs["token_type_ids"]',
  "max_tokens = 512",
  "secret_sauce = compute()",
  'self.auth_token_id = vocab["<auth>"]',
  "bos_token = tokenizer.bos_token",
  "token = next_token",
  "token = nextToken",
  "access_token = request_token",
  "api_key = api_key",
  "token: str = eos_token",
  "self.token = token",
  "token = tokens[0]",
  "auth_token = get_auth_token()",
  'api_key = os.environ["OPENAI_API_KEY"]',
  "secret = secrets.token_hex()",
  "num_tokens = count_tokens(text)",
  "unk_token = pad_token",
];

const REAL_SECRETS: Array<[string, string]> = [
  ['api_key = "sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z"', "sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z"],
  ['token = "ghp_aBcD3fGhIjKlMnOpQrStUvWxYz0123456789"', "ghp_aBcD3fGhIjKlMnOpQrStUvWxYz0123456789"],
  ['password = "xK9#mQ2$vL7pR4wZ"', "xK9#mQ2$vL7pR4wZ"],
  ["password = hunter2x", "hunter2x"],
  ["password = correct_horse", "correct_horse"],
  ["api_key = abcdefghijkl", "abcdefghijkl"],
  ["auth_token = abc123def456", "abc123def456"],
  ["access_token = Zq8_xT3vLm9", "Zq8_xT3vLm9"],
];

describe("RD1: identifiers assigned to identifiers", () => {
  for (const line of ORDINARY_CODE) {
    test(`stays: ${line}`, () => {
      expect(redactSecrets(line)).toBe(line);
      expect(containsSecret(line)).toBe(false);
    });
  }
  for (const [line, secret] of REAL_SECRETS) {
    test(`still redacts: ${line}`, () => {
      expect(redactSecrets(line)).not.toContain(secret);
      expect(redactSecrets(line)).toContain("[REDACTED:");
    });
  }
});
