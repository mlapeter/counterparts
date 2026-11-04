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
  "pad_token_id = eos_token_id",
  "sep_token = cls_token",
  "mask_token = unk_token",
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
  ["HF_TOKEN=hf_abcdefghijklmnopqrstu", "hf_abcdefghijklmnopqrstu"],
  ["SECRET_KEY=correct_horse_battery_staple", "correct_horse_battery_staple"],
  ["export WEBHOOK_SECRET=purple_monkey_dishwasher", "purple_monkey_dishwasher"],
  ["CLIENT_SECRET=tangerine_wombat_sky", "tangerine_wombat_sky"],
  ["API_KEY=my_secret_value", "my_secret_value"],
  ["SESSION_TOKEN=blue_whale_river", "blue_whale_river"],
  ["BEARER_TOKEN=open_sesame", "open_sesame"],
  ["SLACK_TOKEN=xoxp_abcdefghijkl_mnopqrstuvwx", "xoxp_abcdefghijkl_mnopqrstuvwx"],
  ["client_secret: tangerine_wombat_sky", "tangerine_wombat_sky"],
  ["api_key: my_secret_value", "my_secret_value"],
  ["webhookSecret: purpleMonkeyDishwasher", "purpleMonkeyDishwasher"],
  ["client_secret = tangerine_wombat_sky", "tangerine_wombat_sky"],
  ["webhook_secret = correct_horse_battery", "correct_horse_battery"],
  ["secret_key_base = rails_dev_secret_base", "rails_dev_secret_base"],
  ["credentials = admin_letmein", "admin_letmein"],
  ["token = correctHorseBatteryStaple", "correctHorseBatteryStaple"],
  ["apiKey = openSesameDoor", "openSesameDoor"],
  ["secret=letmeinNow", "letmeinNow"],
  ["I set token = sunset_harbor_lime and then restarted", "sunset_harbor_lime"],
  ["token = foo_barbaz; secret = baz_quxquux", "baz_quxquux"],
  ["api_key = xoxb_abcdefghijk", "xoxb_abcdefghijk"],
  ["token = lin_api_abcdefghijkl", "lin_api_abcdefghijkl"],
  ["api_key = aBcdEfghIjklMnop", "aBcdEfghIjklMnop"],
  ["secret = abcdefabcdef_fedcbafedcba", "abcdefabcdef_fedcbafedcba"],
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
