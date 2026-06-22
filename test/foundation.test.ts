/**
 * Foundation tests — covers the framework wiring, global flags, client
 * factory, and vendor/internal-clean invariants.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Dependency closure
// ---------------------------------------------------------------------------
describe("dependency closure", () => {
  const pkg = require(resolve(__dirname, "../package.json")) as {
    type: string;
    dependencies: Record<string, string>;
    name: string;
    version: string;
  };

  it('package.json type === "module"', () => {
    expect(pkg.type).toBe("module");
  });

  it("dependencies includes @curviate/sdk", () => {
    expect(pkg.dependencies).toHaveProperty("@curviate/sdk");
  });

  it("dependencies includes citty", () => {
    expect(pkg.dependencies).toHaveProperty("citty");
  });

  it("dependencies does not include @curviate/shared", () => {
    expect(Object.keys(pkg.dependencies)).not.toContain("@curviate/shared");
  });

  it("name is @curviate/cli", () => {
    expect(pkg.name).toBe("@curviate/cli");
  });

  it("version has the expected semver shape", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// Client factory — verbatim key and SDK defaults
// ---------------------------------------------------------------------------
describe("client factory", () => {
  it("passes apiKey verbatim, sets explicit baseUrl and timeout", async () => {
    const { createClient } = await import("../src/lib/client.js");
    const client = createClient({
      apiKey: "rdc_live_ABC",
      baseUrl: "https://x.test",
      timeout: 5000,
    });
    expect(client.config.apiKey).toBe("rdc_live_ABC");
    expect(client.config.baseUrl).toBe("https://x.test");
    expect(client.config.timeout).toBe(5000);
  });

  it("uses SDK defaults when only apiKey is given", async () => {
    const { createClient } = await import("../src/lib/client.js");
    const client = createClient({ apiKey: "rdc_live_K" });
    expect(client.config.baseUrl).toBe("https://api.curviate.com");
    expect(client.config.timeout).toBe(30000);
  });
});

// ---------------------------------------------------------------------------
// No network calls on construction
// ---------------------------------------------------------------------------
describe("no network on construct", () => {
  it("constructing a client via the factory makes zero network calls", async () => {
    const { createClient } = await import("../src/lib/client.js");

    let fetchCallCount = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetchCallCount++;
      return realFetch(...args);
    }) as typeof fetch;

    try {
      createClient({ apiKey: "rdc_live_K" });
      expect(fetchCallCount).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// No server-side preview parameter in any CLI source file
// ---------------------------------------------------------------------------
describe("no server-preview parameter in CLI source", () => {
  it("no server-side preview or test-mode token in any CLI source file", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join, extname } = await import("node:path");

    async function collectFiles(dir: string): Promise<string[]> {
      const results: string[] = [];
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return results;
      }
      for (const entry of entries) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", "dist"].includes(entry.name)) continue;
          results.push(...(await collectFiles(abs)));
        } else if (
          entry.isFile() &&
          [".ts", ".mjs", ".js"].includes(extname(entry.name))
        ) {
          results.push(abs);
        }
      }
      return results;
    }

    const srcDir = resolve(__dirname, "../src");
    const files = await collectFiles(srcDir);

    const leaks: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      if (/dry[_-]run/i.test(content)) {
        leaks.push(file);
      }
    }

    expect(leaks, `server preview param found in: ${leaks.join(", ")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Global flags type contract
// ---------------------------------------------------------------------------
describe("global flags — type contract", () => {
  it("GLOBAL_FLAGS declares all expected flags", async () => {
    const { GLOBAL_FLAGS } = await import("../src/lib/global-flags.js");
    const keys = Object.keys(GLOBAL_FLAGS);
    const required = [
      "api-key",
      "profile",
      "account",
      "base-url",
      "timeout",
      "json",
      "fields",
      "limit",
      "cursor",
      "all",
      "max-pages",
      "preview",
    ];
    for (const k of required) {
      expect(keys, `missing global flag "${k}"`).toContain(k);
    }
  });

  it("boolean flags have type boolean", async () => {
    const { GLOBAL_FLAGS } = await import("../src/lib/global-flags.js");
    expect(GLOBAL_FLAGS.json.type).toBe("boolean");
    expect(GLOBAL_FLAGS.all.type).toBe("boolean");
    expect(GLOBAL_FLAGS.preview.type).toBe("boolean");
  });

  it("string flags have type string", async () => {
    const { GLOBAL_FLAGS } = await import("../src/lib/global-flags.js");
    expect(GLOBAL_FLAGS["api-key"].type).toBe("string");
    expect(GLOBAL_FLAGS.account.type).toBe("string");
    expect(GLOBAL_FLAGS.fields.type).toBe("string");
    expect(GLOBAL_FLAGS.cursor.type).toBe("string");
  });
});
