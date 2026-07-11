/**
 * Compile-coupling foundation.
 *
 * Three checks that together prove the coupling fix: removing the hand-rolled
 * `MinimalClient` shim and typing every command handler against the real
 * exported `@curviate/sdk` client converts a whole class of latent runtime
 * breaks into build-time failures.
 *
 *   (a) functional — the getCompany crash path is re-pointed to companies.get,
 *       and the removed `profiles.getCompany` is never referenced.
 *   (b) static     — no command file severs the real client type with an
 *       `as unknown as` cast, and no `MinimalClient` shim survives.
 *   (c) compile    — the negative control: with the shim removed a stale call
 *       site fails `tsc` at that exact line; under the old shim the identical
 *       line type-checks green. The contrast is the proof.
 */

import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// (a) functional — profile <slug> --is-company --posts crash path
// ---------------------------------------------------------------------------

describe("functional — getCompany crash path re-pointed to companies.get", () => {
  it("resolves the company via companies.get, then lists via posts.listUserPosts", async () => {
    const { runProfileGet } = await import("../../src/commands/profile.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    // The account-scoped namespace stub carries ONLY the v2 surface — there is
    // deliberately no `profiles` namespace, so any lingering reference to the
    // removed `profiles.getCompany` would throw rather than pass silently.
    const ns = {
      companies: { get: vi.fn().mockResolvedValue({ id: "123" }) },
      posts: { listUserPosts: vi.fn().mockResolvedValue({ items: [], cursor: null }) },
    };
    const client = { account: vi.fn().mockReturnValue(ns) };

    await runProfileGet(
      client as never,
      { id: "acme-inc", posts: true, "is-company": true, account: "acc_1", json: true } as never,
      out,
    );

    expect(ns.companies.get).toHaveBeenCalledWith("acme-inc");
    expect(ns.posts.listUserPosts).toHaveBeenCalledWith("123", expect.any(Object));
    // The numeric id from companies.get — not the slug — is what reaches listUserPosts.
    expect((ns.posts.listUserPosts as Mock).mock.calls[0]![0]).toBe("123");
  });
});

// ---------------------------------------------------------------------------
// (b) static — zero client/namespace casts, zero MinimalClient shims
// ---------------------------------------------------------------------------

describe("static — no severing casts survive in the command surface", () => {
  const commandsDir = resolve(process.cwd(), "src/commands");
  const files = readdirSync(commandsDir).filter((f) => f.endsWith(".ts"));

  it("enumerates every command file", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no command file contains an `as unknown as` cast", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(resolve(commandsDir, f), "utf8");
      text.split("\n").forEach((line, i) => {
        if (line.includes("as unknown as")) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, `client/namespace casts must be zero; found: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no command file declares a hand-rolled `MinimalClient` shim", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(resolve(commandsDir, f), "utf8");
      if (/\bMinimalClient\b/.test(text)) offenders.push(f);
    }
    expect(offenders, `MinimalClient shims must be gone; found in: ${offenders.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (c) compile — the negative control
// ---------------------------------------------------------------------------

function typecheckFixture(relPath: string): { code: number; output: string } {
  const tsc = resolve(process.cwd(), "node_modules/typescript/bin/tsc");
  const flags = [
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--moduleResolution", "bundler",
    "--module", "esnext",
    "--target", "es2020",
    "--types", "node",
  ];
  try {
    const output = execFileSync("node", [tsc, ...flags, relPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("compile — the gate bites (negative control)", () => {
  it("shim REMOVED: the stale call site fails tsc at that exact line (property does not exist)", () => {
    const { code, output } = typecheckFixture("test/coupling/fixtures/stale-call-shim-removed.ts");
    expect(code, `expected a compile failure, got:\n${output}`).not.toBe(0);
    expect(output).toContain("stale-call-shim-removed.ts");
    expect(output).toMatch(/error TS2339: Property 'profiles' does not exist/);
  });

  it("shim PRESENT: the identical stale call type-checks green", () => {
    const { code, output } = typecheckFixture("test/coupling/fixtures/stale-call-shimmed.ts");
    expect(code, `expected a clean compile, got:\n${output}`).toBe(0);
    expect(output.trim()).toBe("");
  });
}, 30_000);
