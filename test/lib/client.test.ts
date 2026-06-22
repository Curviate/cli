import { describe, it, expect, vi } from "vitest";
import { createClient } from "../../src/lib/client.js";

describe("lib/client — createClient factory", () => {
  it("passes apiKey verbatim (no prefix validation)", () => {
    const client = createClient({
      apiKey: "rdc_live_ABC",
      baseUrl: "https://x.test",
      timeout: 5000,
    });
    expect(client.config.apiKey).toBe("rdc_live_ABC");
  });

  it("passes baseUrl verbatim", () => {
    const client = createClient({
      apiKey: "rdc_live_K",
      baseUrl: "https://x.test",
      timeout: 5000,
    });
    expect(client.config.baseUrl).toBe("https://x.test");
  });

  it("passes timeout verbatim", () => {
    const client = createClient({
      apiKey: "rdc_live_K",
      baseUrl: "https://x.test",
      timeout: 5000,
    });
    expect(client.config.timeout).toBe(5000);
  });

  it("uses SDK defaults when only apiKey is given", () => {
    const client = createClient({ apiKey: "rdc_live_K" });
    expect(client.config.baseUrl).toBe("https://api.curviate.com");
    expect(client.config.timeout).toBe(30000);
  });

  it("makes zero network calls on construction (no fetch)", () => {
    // Spy on global fetch to confirm it is never called at construction.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    createClient({ apiKey: "rdc_live_K" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("trims surrounding whitespace from apiKey", () => {
    // The spec says 'no trimming beyond surrounding whitespace' — whitespace IS trimmed.
    const client = createClient({ apiKey: "  rdc_live_abc  " });
    expect(client.config.apiKey).toBe("rdc_live_abc");
  });

  it("factory is the only construction point — returns a Curviate instance", () => {
    const client = createClient({ apiKey: "rdc_live_K" });
    // Has the expected resource namespaces.
    expect(client).toHaveProperty("accounts");
    expect(client).toHaveProperty("messaging");
    expect(client).toHaveProperty("profiles");
  });
});
