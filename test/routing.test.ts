/**
 * Black-box routing tests — spawn the BUILT bin (dist/cli.js) and assert the
 * dispatcher routes bare intent-shaped forms and subcommands correctly.
 *
 * These tests exercise the real command-line router end-to-end, which the
 * unit tests (which call the exported run functions directly) cannot: the
 * router lives between argv and those functions, and a routing regression is
 * invisible unless argv is actually parsed by the bin.
 *
 * Two probe strategies, both network-free or deterministically-network:
 *   - `--preview` on a write form renders the pending request and exits 0
 *     without any network call. We assert the rendered method + a single
 *     render line.
 *   - For reads, we point `--base-url` at an unroutable host and assert the
 *     failure is the downstream network/SDK error (exit code from the
 *     error→exit map), NOT a routing "Unknown command" (which would mean the
 *     bare positional never reached the handler).
 *
 * NODE_ENV=production is required so the underlying CLI framework's console
 * is not silenced by test-mode detection.
 *
 * Build prerequisite: `pnpm build` must have produced a current dist/cli.js.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const cliPath = resolve(pkgRoot, "dist", "cli.js");

// A syntactically-valid but unroutable base URL: connections are refused
// immediately, so the SDK surfaces a network error fast (no long timeout).
const UNROUTABLE = "http://127.0.0.1:1";

function run(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, NODE_ENV: "production", CURVIATE_API_KEY: "rdc_live_routing_test_stub" },
  });
}

/** Combined output, useful for "must NOT be a routing error" assertions. */
function combined(r: ReturnType<typeof run>): string {
  return (r.stdout ?? "") + (r.stderr ?? "");
}

/** True when the output is the framework's "unknown command" routing error. */
function isUnknownCommand(r: ReturnType<typeof run>): boolean {
  return /Unknown command/i.test(combined(r));
}

beforeAll(() => {
  // Ensure dist is current. The build is fast (~60ms) and idempotent.
  if (!existsSync(cliPath)) {
    execSync("pnpm build", { cwd: pkgRoot, stdio: "ignore" });
  }
});

describe("router — bare intent-shaped forms reach the handler (not 'Unknown command')", () => {
  it("connect <slug> --note --preview renders invites.send and exits 0", () => {
    const r = run([
      "connect", "jdoe",
      "--note", "hi",
      "--preview",
      "--account", "acc_x",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("invites.send");
    // Exactly one preview render line (no stray second method).
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });

  it("profile <slug> (bare get) reaches the SDK path — network error, not a routing error", () => {
    const r = run([
      "profile", "jdoe",
      "--account", "acc_x",
      "--base-url", UNROUTABLE,
      "--json",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    // Reached the SDK and failed on the network — INTERNAL maps to exit 1.
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/"error"/);
  });

  it("profile <slug> --posts reaches the list-posts SDK path (not a routing error)", () => {
    const r = run([
      "profile", "jdoe",
      "--posts",
      "--account", "acc_x",
      "--base-url", UNROUTABLE,
      "--json",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/"error"/);
  });

  it("profile '<url>' --posts reaches the SDK path (url-shaped positional)", () => {
    const r = run([
      "profile", "https://www.linkedin.com/in/jdoe/",
      "--posts",
      "--account", "acc_x",
      "--base-url", UNROUTABLE,
      "--json",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/"error"/);
  });

  it("message <chat_id> \"text\" --preview renders ONLY messaging.sendMessage, exits 0", () => {
    const r = run([
      "message", "chat_9", "hi",
      "--preview",
      "--account", "acc_x",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("messaging.sendMessage");
    // The bare send form must NOT also fan out to startChat.
    expect(r.stdout).not.toContain("messaging.startChat");
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });
});

describe("router — subcommands still route after the bare-form fix", () => {
  it("profile me reaches the getMe SDK path (subcommand, not bare)", () => {
    const r = run([
      "profile", "me",
      "--account", "acc_x",
      "--base-url", UNROUTABLE,
      "--json",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/"error"/);
  });

  it("connect sent reaches the listSent SDK path (subcommand)", () => {
    const r = run([
      "connect", "sent",
      "--account", "acc_x",
      "--base-url", UNROUTABLE,
      "--json",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/"error"/);
  });

  it("message new --preview renders ONLY messaging.startChat (one method), exits 0", () => {
    const r = run([
      "message", "new",
      "--to", "ACo123", "hello",
      "--preview",
      "--account", "acc_x",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("messaging.startChat");
    expect(r.stdout).not.toContain("messaging.sendMessage");
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });

  it("job get <url> reaches the jobs.get SDK path (subcommand, not bare)", () => {
    const r = run([
      "job", "get", "https://www.linkedin.com/jobs/view/4428113858",
      "--account", "acc_x",
      "--base-url", UNROUTABLE,
      "--json",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/"error"/);
  });

  it("recruiter job get <id> reaches the recruiter.getJob SDK path (nested subcommand)", () => {
    const r = run([
      "recruiter", "job", "get", "4428113858",
      "--account", "acc_x",
      "--base-url", UNROUTABLE,
      "--json",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/"error"/);
  });

  it("recruiter job applicants <job_id> still routes correctly (job get does not shadow other job verbs)", () => {
    const r = run([
      "recruiter", "job", "applicants", "job_99",
      "--account", "acc_x",
      "--base-url", UNROUTABLE,
      "--json",
    ]);
    expect(isUnknownCommand(r)).toBe(false);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/"error"/);
  });
});

describe("router — usage/routing errors exit 2", () => {
  it("unknown top-level command exits 2", () => {
    const r = run(["bogus-command"]);
    expect(r.status).toBe(2);
  });

  it("unknown subcommand under a pure group exits 2", () => {
    const r = run(["account", "bogus-sub"]);
    expect(r.status).toBe(2);
  });

  it("unknown flag exits 2", () => {
    const r = run(["profile", "me", "--no-such-flag", "--account", "acc_x"]);
    expect(r.status).toBe(2);
  });

  it("missing required flag exits 2 (usage error, not internal)", () => {
    // `webhook create` requires --source / --request-url / --account-ids.
    const r = run(["webhook", "create"]);
    expect(r.status).toBe(2);
  });
});

describe("router — successful data commands write nothing to stderr", () => {
  it("connect <slug> --preview: stderr is empty on success", () => {
    const r = run([
      "connect", "jdoe",
      "--note", "hi",
      "--preview",
      "--account", "acc_x",
    ]);
    expect(r.status).toBe(0);
    expect(r.stderr.trim()).toBe("");
  });

  it("webhook create --preview: stderr is empty on success", () => {
    const r = run([
      "webhook", "create",
      "--source", "messaging",
      "--request-url", "https://example.com/hook",
      "--account-ids", "acc_1",
      "--preview",
    ]);
    expect(r.status).toBe(0);
    expect(r.stderr.trim()).toBe("");
  });
});

describe("router — projection arg validated before any SDK call", () => {
  it("--fields '' exits 2 (validated pre-call, no network)", () => {
    const r = run([
      "profile", "me",
      "--fields", "",
      "--account", "acc_x",
      "--base-url", UNROUTABLE,
      "--json",
    ]);
    // Must be the usage exit (2), NOT a downstream INTERNAL network error (1).
    expect(r.status).toBe(2);
  });
});
