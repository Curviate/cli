/**
 * Black-box smoke gate for the built dist.
 *
 * Runs AFTER `pnpm build`. Spawns `dist/cli.js` directly (not src/) and
 * asserts the binary behaves correctly. This is the build-output regression
 * gate, run before publish.
 *
 * Run:  node scripts/verify-dist.mjs
 * Exit 0 = all assertions passed.
 * Exit 1 = a case failed — prints the failure and aborts.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const cliPath = resolve(pkgRoot, "dist", "cli.js");
const pkgJson = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));
const expectedVersion = pkgJson.version;

// Vendor name and internal codenames assembled from fragments so the literals
// never appear in this file and don't trip the scanner on itself.
const vendorName = ["uni", "pi", "le"].join("");
const codenamePat = new RegExp(
  ["red" + "arc", "@curviate/" + "shared", "apps/" + "server"].join("|"),
  ""
);
const LEAK_PATTERNS = [
  new RegExp(vendorName, "i"),
  /\b(FR|AC|NFR|TS|ADR)-\d+/,
  /#\d{3,}/,
  codenamePat,
  /docs\/(specs|adr)\b/,
];

function assert(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

// Run CLI with NODE_ENV=production so consola is not silenced by test-mode detection.
function run(args, opts) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, NODE_ENV: "production" },
    ...opts,
  });
}

function assertLeakFree(text, context) {
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(text)) {
      console.error(`FAIL: leak detected in ${context} output — pattern ${pattern}`);
      console.error(`      matched in: ${text.slice(0, 200)}`);
      process.exit(1);
    }
  }
}

/**
 * Build a valid X-Curviate-Signature header.
 * HMAC-SHA256(secret, "${timestamp}.${body}") → "t=${t},v1=${hmac}"
 * Mirrors the SDK's constructEvent payload construction.
 */
function buildSignatureHeader(secret, bodyStr, nowSecs) {
  const t = nowSecs ?? Math.floor(Date.now() / 1000);
  const payload = `${t}.${bodyStr}`;
  const hmac = createHmac("sha256", secret).update(payload).digest("hex");
  return `t=${t},v1=${hmac}`;
}

/**
 * Write content to a temp file, run fn with the path, then delete it.
 */
function withTempFile(content, fn) {
  const tmpFile = join(tmpdir(), `curviate-verify-${Date.now()}.json`);
  writeFileSync(tmpFile, content, "utf8");
  try {
    return fn(tmpFile);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

console.log("=== verify-dist: CLI binary smoke gate ===\n");

// ---------------------------------------------------------------------------
// 1. --version: prints expected version and exits 0
// ---------------------------------------------------------------------------
{
  const result = run(["--version"]);
  assert(result.status === 0, `--version exits 0 (got ${result.status})`);
  const printed = (result.stdout + result.stderr).trim();
  assert(
    printed.includes(expectedVersion),
    `--version output contains "${expectedVersion}" (got "${printed}")`
  );
  assertLeakFree(printed, "--version");
}

// ---------------------------------------------------------------------------
// 2. --help: exits 0, output is leak-clean
// ---------------------------------------------------------------------------
{
  const result = run(["--help"]);
  assert(result.status === 0, `--help exits 0 (got ${result.status})`);
  const helpText = result.stdout + result.stderr;
  assert(helpText.length > 0, "--help produces output");
  assertLeakFree(helpText, "--help");
}

// ---------------------------------------------------------------------------
// 3. no arguments: exits 0
// ---------------------------------------------------------------------------
{
  const result = run([]);
  assert(result.status === 0, `no-args exits 0 (got ${result.status})`);
}

// ---------------------------------------------------------------------------
// 4. --preview write: exits 0, no network call, output does not contain dry_run
//    Uses `webhook create --preview` — an offline preview render (root-scoped,
//    all required flags provided, no account or network needed).
// ---------------------------------------------------------------------------
{
  const result = run([
    "webhook", "create",
    "--source", "messaging",
    "--request-url", "https://example.com/hook",
    "--account-ids", "acc_1",
    "--preview",
    "--api-key", "rdc_live_verify_dist_stub",
  ]);
  assert(
    result.status === 0,
    `webhook create --preview exits 0 (got ${result.status}; stderr: ${result.stderr.slice(0, 200)})`
  );
  const out = result.stdout + result.stderr;
  assert(
    !(/dry[_-]run/i.test(out)),
    `--preview output must not contain "dry_run" token`
  );
  assert(
    out.includes("webhooks.create") || out.includes("preview"),
    `--preview output should describe the pending request (got: ${out.slice(0, 200)})`
  );
  assertLeakFree(out, "webhook create --preview");
}

// ---------------------------------------------------------------------------
// 5. webhook verify — valid header: exits 0, prints event JSON
//
// Body must be a valid CurviateEvent JSON with a "type" field.
// Write to a temp file because readFileSync("/dev/stdin") does not interop
// with spawnSync's `input` option on all platforms.
// ---------------------------------------------------------------------------
{
  const secret = "curviate_verify_dist_gate_secret";
  const eventBody = JSON.stringify({
    type: "message.received",
    data: { account_id: "acc_1", message_id: "msg_1" },
    id: "evt_1",
  });
  const header = buildSignatureHeader(secret, eventBody);

  withTempFile(eventBody, (tmpFile) => {
    const result = run([
      "webhook", "verify",
      "--secret", secret,
      "--header", header,
      "--body", tmpFile,
    ]);
    assert(
      result.status === 0,
      `webhook verify (valid) exits 0 (got ${result.status}; stderr: ${result.stderr.slice(0, 200)})`
    );
    const out = result.stdout + result.stderr;
    assert(out.trim().length > 0, "webhook verify (valid) produces output");
    // Parsed event should appear in stdout
    assert(
      result.stdout.includes("message.received"),
      `webhook verify (valid) stdout should contain the event type (got: ${result.stdout.slice(0, 200)})`
    );
    assertLeakFree(out, "webhook verify (valid)");
  });
}

// ---------------------------------------------------------------------------
// 6. webhook verify — bad signature: exits 2
// ---------------------------------------------------------------------------
{
  const secret = "curviate_verify_dist_gate_secret";
  const eventBody = JSON.stringify({ type: "message.received", data: { account_id: "acc_1" }, id: "evt_1" });
  const t = Math.floor(Date.now() / 1000);
  // Deliberately wrong HMAC (all zeros)
  const badHeader = `t=${t},v1=${"0".repeat(64)}`;

  withTempFile(eventBody, (tmpFile) => {
    const result = run([
      "webhook", "verify",
      "--secret", secret,
      "--header", badHeader,
      "--body", tmpFile,
    ]);
    assert(
      result.status === 2,
      `webhook verify (bad signature) exits 2 (got ${result.status})`
    );
  });
}

// ---------------------------------------------------------------------------
// 7. webhook verify — stale timestamp (replay_detected): exits 2
// ---------------------------------------------------------------------------
{
  const secret = "curviate_verify_dist_gate_secret";
  const eventBody = JSON.stringify({ type: "message.received", data: { account_id: "acc_1" }, id: "evt_1" });
  // Timestamp 10 minutes in the past — well outside the 5-minute replay window
  const staleTs = Math.floor(Date.now() / 1000) - 600;
  const staleHeader = buildSignatureHeader(secret, eventBody, staleTs);

  withTempFile(eventBody, (tmpFile) => {
    const result = run([
      "webhook", "verify",
      "--secret", secret,
      "--header", staleHeader,
      "--body", tmpFile,
    ]);
    assert(
      result.status === 2,
      `webhook verify (stale/replay) exits 2 (got ${result.status})`
    );
  });
}

// ---------------------------------------------------------------------------
// 8. Usage error (missing required flag): exits non-zero
//    `webhook create` requires --source, --request-url, --account-ids.
//    Passing only --api-key should yield a usage error.
// ---------------------------------------------------------------------------
{
  const result = run([
    "webhook", "create",
    "--api-key", "rdc_live_verify_dist_stub",
  ]);
  assert(
    result.status !== 0,
    `webhook create (missing required flags) exits non-zero (got ${result.status})`
  );
}

// ---------------------------------------------------------------------------
// 9. Subcommand --help spot-checks: exit 0, leak-clean
// ---------------------------------------------------------------------------
{
  const spotChecks = [
    ["profile", "--help"],
    ["account", "list", "--help"],
    ["webhook", "verify", "--help"],
    ["sales-nav", "--help"],
    ["recruiter", "search", "--help"],
  ];

  for (const args of spotChecks) {
    const result = run(args);
    const helpText = result.stdout + result.stderr;
    assert(result.status === 0, `${args.join(" ")} exits 0 (got ${result.status})`);
    assert(helpText.length > 0, `${args.join(" ")} produces output`);
    assertLeakFree(helpText, args.join(" "));
  }
}

console.log("\nAll dist checks passed.");
