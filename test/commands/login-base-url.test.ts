/**
 * Tests for `login --base-url` persistence.
 *
 * Uses XDG_CONFIG_HOME override so each test is fully isolated from the
 * real user config and from each other.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("login — --base-url persistence", () => {
  let tempDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "curviate-login-test-"));
    origXdg = process.env["XDG_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = tempDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (origXdg === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = origXdg;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("--base-url is persisted to the profile config", async () => {
    const { runLogin } = await import("../../src/commands/login.js");
    const { readConfig } = await import("../../src/lib/config.js");
    const out = { stderr: { write: vi.fn() } };

    await runLogin(
      {
        "api-key": "rdc_live_X",
        "base-url": "https://custom.api.example.com",
        profile: "default",
      },
      out,
    );

    const cfg = await readConfig();
    expect(cfg?.profiles["default"]?.baseUrl).toBe("https://custom.api.example.com");
    expect(cfg?.profiles["default"]?.apiKey).toBe("rdc_live_X");
  });

  it("re-login without --base-url preserves existing baseUrl (merge behavior)", async () => {
    const { runLogin } = await import("../../src/commands/login.js");
    const { readConfig } = await import("../../src/lib/config.js");
    const out = { stderr: { write: vi.fn() } };

    // First login sets baseUrl
    await runLogin(
      {
        "api-key": "rdc_live_X",
        "base-url": "https://custom.api.example.com",
        profile: "default",
      },
      out,
    );

    // Second login without --base-url (undefined, not "")
    await runLogin(
      { "api-key": "rdc_live_Y", profile: "default" },
      out,
    );

    const cfg = await readConfig();
    expect(cfg?.profiles["default"]?.apiKey).toBe("rdc_live_Y");
    // baseUrl must survive the second write (writeProfile merges)
    expect(cfg?.profiles["default"]?.baseUrl).toBe("https://custom.api.example.com");
  });

  it("--base-url '' exits 2 with usage error, config not written", async () => {
    const { runLogin } = await import("../../src/commands/login.js");
    const { readConfig } = await import("../../src/lib/config.js");
    const out = { stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(
      (code?: number | string | null) => {
        throw new Error(`process.exit(${code})`);
      },
    );

    try {
      await runLogin(
        { "api-key": "rdc_live_Z", "base-url": "" },
        out,
      );
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }

    const stderrCalls = (out.stderr.write as Mock).mock.calls
      .map((c) => c[0] as string)
      .join("");
    expect(stderrCalls).toMatch(/--base-url.*empty/i);

    // Config must not have been written
    const cfg = await readConfig();
    expect(cfg).toBeNull();
  });
});
