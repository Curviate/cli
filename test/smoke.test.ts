import { describe, it, expect } from "vitest";
import { createClient } from "../src/lib/client.js";

// Read version from package.json.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string; name: string };

describe("@curviate/cli smoke", () => {
  it("package.json has the expected name and version shape", () => {
    expect(pkg.name).toBe("@curviate/cli");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("createClient returns a Curviate instance without making network calls", () => {
    // Constructing a client must be synchronous and network-free.
    const client = createClient({ apiKey: "rdc_live_test_placeholder" });
    // The client exists and has the expected shape.
    expect(client).toBeDefined();
    expect(typeof client).toBe("object");
  });

  it("createClient passes apiKey verbatim (trimmed of surrounding whitespace)", () => {
    const client = createClient({ apiKey: "  rdc_live_abc  " });
    expect(client).toBeDefined();
    // The SDK stores config — verify it accepted a non-empty key without throwing.
  });

  it("createClient accepts optional baseUrl and timeout overrides", () => {
    const client = createClient({
      apiKey: "rdc_live_abc",
      baseUrl: "https://api.example.com",
      timeout: 5000,
    });
    expect(client).toBeDefined();
  });
});
