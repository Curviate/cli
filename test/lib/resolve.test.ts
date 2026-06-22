import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeProfile } from "../../src/lib/config.js";
import { resolveEffectiveConfig } from "../../src/lib/resolve.js";

describe("lib/resolve — effective config precedence", () => {
  let tmpDir: string;
  let origXdg: string | undefined;
  let origApiKey: string | undefined;
  let origBaseUrl: string | undefined;
  let origAccount: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "curviate-test-resolve-"));
    origXdg = process.env["XDG_CONFIG_HOME"];
    origApiKey = process.env["CURVIATE_API_KEY"];
    origBaseUrl = process.env["CURVIATE_BASE_URL"];
    origAccount = process.env["CURVIATE_ACCOUNT"];
    process.env["XDG_CONFIG_HOME"] = tmpDir;
    delete process.env["CURVIATE_API_KEY"];
    delete process.env["CURVIATE_BASE_URL"];
    delete process.env["CURVIATE_ACCOUNT"];
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = origXdg;
    }
    if (origApiKey === undefined) {
      delete process.env["CURVIATE_API_KEY"];
    } else {
      process.env["CURVIATE_API_KEY"] = origApiKey;
    }
    if (origBaseUrl === undefined) {
      delete process.env["CURVIATE_BASE_URL"];
    } else {
      process.env["CURVIATE_BASE_URL"] = origBaseUrl;
    }
    if (origAccount === undefined) {
      delete process.env["CURVIATE_ACCOUNT"];
    } else {
      process.env["CURVIATE_ACCOUNT"] = origAccount;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("all three layers: flag > env > profile", async () => {
    await writeProfile("default", {
      apiKey: "rdc_live_P",
      baseUrl: "https://p.test",
      account: "acc_p",
    });
    process.env["CURVIATE_API_KEY"] = "rdc_live_E";

    // All flags present: flag wins everywhere
    const result = await resolveEffectiveConfig({
      apiKey: "rdc_live_F",
      baseUrl: "https://f.test",
      account: "acc_f",
    });
    expect(result.apiKey).toBe("rdc_live_F");
    expect(result.baseUrl).toBe("https://f.test");
    expect(result.account).toBe("acc_f");
  });

  it("env > profile when no flag", async () => {
    await writeProfile("default", {
      apiKey: "rdc_live_P",
      baseUrl: "https://p.test",
      account: "acc_p",
    });
    process.env["CURVIATE_API_KEY"] = "rdc_live_E";

    // No flags — env key wins, profile base URL wins (no env override for it)
    const result = await resolveEffectiveConfig({});
    expect(result.apiKey).toBe("rdc_live_E");
    expect(result.baseUrl).toBe("https://p.test");
    expect(result.account).toBe("acc_p");
  });

  it("profile only when no flag and no env", async () => {
    await writeProfile("default", {
      apiKey: "rdc_live_P",
      baseUrl: "https://p.test",
      account: "acc_p",
    });

    const result = await resolveEffectiveConfig({});
    expect(result.apiKey).toBe("rdc_live_P");
    expect(result.baseUrl).toBe("https://p.test");
    expect(result.account).toBe("acc_p");
  });

  it("base URL defaults to SDK default when not set anywhere", async () => {
    await writeProfile("default", { apiKey: "rdc_live_P" });
    const result = await resolveEffectiveConfig({});
    expect(result.baseUrl).toBe("https://api.curviate.com");
  });

  it("timeout defaults to 30000 when not set anywhere", async () => {
    await writeProfile("default", { apiKey: "rdc_live_P" });
    const result = await resolveEffectiveConfig({});
    expect(result.timeout).toBe(30000);
  });

  it("timeout from flag string (numeric string → number)", async () => {
    await writeProfile("default", { apiKey: "rdc_live_P" });
    const result = await resolveEffectiveConfig({ timeout: "5000" });
    expect(result.timeout).toBe(5000);
  });

  it("no API key anywhere → apiKey is undefined", async () => {
    const result = await resolveEffectiveConfig({});
    expect(result.apiKey).toBeUndefined();
  });

  it("CURVIATE_ACCOUNT env overrides profile account", async () => {
    await writeProfile("default", {
      apiKey: "rdc_live_P",
      account: "acc_p",
    });
    process.env["CURVIATE_ACCOUNT"] = "acc_env";
    const result = await resolveEffectiveConfig({});
    expect(result.account).toBe("acc_env");
  });

  it("CURVIATE_BASE_URL env overrides profile baseUrl", async () => {
    await writeProfile("default", {
      apiKey: "rdc_live_P",
      baseUrl: "https://p.test",
    });
    process.env["CURVIATE_BASE_URL"] = "https://env.test";
    const result = await resolveEffectiveConfig({});
    expect(result.baseUrl).toBe("https://env.test");
  });

  it("--profile selects a non-active profile", async () => {
    await writeProfile("default", { apiKey: "rdc_live_DEFAULT" });
    await writeProfile("work", { apiKey: "rdc_live_WORK" });
    const result = await resolveEffectiveConfig({ profile: "work" });
    expect(result.apiKey).toBe("rdc_live_WORK");
  });
});
