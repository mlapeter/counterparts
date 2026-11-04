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
  "pin_memory=True",
  "dataloader = DataLoader(ds, pin_memory=True)",
  "bypass = skip_auth",
  'compass = "north"',
  "session_key_fn = make_key()",
  'private_key_path = "keys/a.pem"',
  'private_key = "keys/server.pem"',
  "auth = request.auth",
  'author = "bob"',
  "password_hash = compute_hash",
  "pass_rate = 0.93",
  "auth: failed",
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
  ["passphrase = correct horse", "correct"],
  ['passphrase = "correct horse battery"', "correct horse battery"],
  ["passphrase=correct_horse_battery", "correct_horse_battery"],
  ["passphrase: xK9mQ2vL7pR4", "xK9mQ2vL7pR4"],
  ["db_pass = hunter2x", "hunter2x"],
  ["DB_PASS=Zq8xT3vLm9", "Zq8xT3vLm9"],
  ['user_pass: "s3cr3tvalue"', "s3cr3tvalue"],
  ["user_pass = correct_horse", "correct_horse"],
  ["pin = 123456", "123456"],
  ['pin = "4821"', "4821"],
  ["PIN=1234", "1234"],
  ['private_key = "xK9mQ2vL7pR4wZ8nB3"', "xK9mQ2vL7pR4wZ8nB3"],
  ['privateKey: "xK9mQ2vL7pR4wZ8nB3"', "xK9mQ2vL7pR4wZ8nB3"],
  ["private_key = correct_horse_battery", "correct_horse_battery"],
  ["signing_key = abc123XYZ789", "abc123XYZ789"],
  ["SIGNING_KEY=correct_horse_battery", "correct_horse_battery"],
  ["session_key = qW3rT5yU7i", "qW3rT5yU7i"],
  ["session_key: purple_monkey_dishwasher", "purple_monkey_dishwasher"],
  ["AUTH=Zq8xT3vLm9pp", "Zq8xT3vLm9pp"],
  ["BEARER=Zq8xT3vLm9pp", "Zq8xT3vLm9pp"],
  ["BEARER=correct_horse_battery", "correct_horse_battery"],
];

test("a PEM block under private_key is still caught (by the private-key-block rule)", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234abcd\n-----END RSA PRIVATE KEY-----";
  expect(redactSecrets(`private_key = "${pem.replace(/\n/g, "\\n")}"`)).not.toContain("MIIEow");
  expect(redactSecrets(`private_key = """${pem}"""`)).not.toContain("MIIEow");
});

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
