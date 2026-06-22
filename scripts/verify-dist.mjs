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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

function run(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: 10_000,
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

console.log("=== verify-dist: CLI binary smoke gate ===\n");

// 1. --version: prints expected version and exits 0
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

// 2. --help: exits 0, output is leak-clean
{
  const result = run(["--help"]);
  assert(result.status === 0, `--help exits 0 (got ${result.status})`);
  const helpText = result.stdout + result.stderr;
  assert(helpText.length > 0, "--help produces output");
  assertLeakFree(helpText, "--help");
}

// 3. no arguments: exits 0 (root help; dev fills the command tree in a follow-up pass)
{
  const result = run([]);
  assert(result.status === 0, `no-args exits 0 (got ${result.status})`);
}

console.log("\nAll dist checks passed.");
