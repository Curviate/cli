/**
 * Tests for the `company` command group.
 * Covers: routing, identifier resolution, --preview/--all errors,
 * slim projection (default mode), --verbose (full SDK response).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeAccountNs() {
  return {
    profiles: {
      getCompany: vi.fn(),
    },
  };
}

function makeClient(accountNs: ReturnType<typeof makeAccountNs>) {
  return {
    account: vi.fn().mockReturnValue(accountNs),
    profiles: accountNs.profiles,
  };
}

type CompanyArgs = {
  id?: string;
  account?: string;
  json?: boolean;
  preview?: boolean;
  all?: boolean;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
  fields?: string;
  limit?: string;
  cursor?: string;
  "max-pages"?: string;
  verbose?: boolean;
};

describe("company command", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.getCompany as Mock).mockResolvedValue({ id: "acme" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("company <id> — calls profiles.getCompany with resolved slug", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runCompanyGet(client as never, { id: "https://www.linkedin.com/company/acme/about/", account: "acc_1", json: true } as CompanyArgs, out);

    // company is NOT account-scoped per profiles.getCompany signature (root-level profiles NS)
    expect(accountNs.profiles.getCompany).toHaveBeenCalledWith("acme");
  });

  it("company bare slug — passes through unchanged", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runCompanyGet(client as never, { id: "acme-corp", json: true } as CompanyArgs, out);

    expect(accountNs.profiles.getCompany).toHaveBeenCalledWith("acme-corp");
  });

  it("company --preview → usage error exit 2 (read command)", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runCompanyGet(client as never, { id: "acme", preview: true } as CompanyArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("company --all → usage error exit 2 (non-paginated)", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runCompanyGet(client as never, { id: "acme", all: true } as CompanyArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// slim mode (no --verbose)
// ---------------------------------------------------------------------------

describe("company slim mode (no --verbose)", () => {
  const richCompany = {
    id: "co_123",
    name: "Acme Corp",
    public_identifier: "acme-corp",
    profile_url: "https://linkedin.com/company/acme-corp",
    industry: "Technology",
    employee_count: 500,
    employee_count_range: { min: 201, max: 500, to: null },
    website: "https://acme.com",
    foundation_date: "2000-01-01",
    messaging: { is_enabled: true, thread_id: "t_1", extra: "hidden" },
    locations: [
      { city: "Austin", country: "US", area: "TX", is_headquarter: true },
    ],
    followers_count: 12000,
    viewer_permissions: { can_send_message: false },
    description: "A company description",
    activities: [{ id: "act_1" }],
  };

  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.getCompany as Mock).mockResolvedValue(richCompany);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slim output has exactly the 12 fields", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runCompanyGet(client as never, { id: "acme-corp", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(Object.keys(result)).toHaveLength(12);
  });

  it("messaging projected to {is_enabled} only (not full object)", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runCompanyGet(client as never, { id: "acme-corp", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result["messaging"]).toEqual({ is_enabled: true });
    const msg = result["messaging"] as Record<string, unknown>;
    expect(msg["thread_id"]).toBeUndefined();
    expect(msg["extra"]).toBeUndefined();
  });

  it("headquarters synthesized from is_headquarter location", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runCompanyGet(client as never, { id: "acme-corp", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result["headquarters"]).toEqual({ city: "Austin", country: "US", area: "TX" });
  });

  it("headquarters null when no hq location", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.profiles.getCompany as Mock).mockResolvedValue({
      ...richCompany,
      locations: [{ city: "Berlin", country: "DE", is_headquarter: false }],
    });

    await runCompanyGet(client as never, { id: "acme-corp", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result["headquarters"]).toBeNull();
  });

  it("heavy fields excluded (viewer_permissions, description, activities, locations raw)", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runCompanyGet(client as never, { id: "acme-corp", account: "acc_1", json: true } as CompanyArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result).not.toHaveProperty("viewer_permissions");
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("activities");
    expect(result).not.toHaveProperty("locations");
  });
});

// ---------------------------------------------------------------------------
// --verbose mode
// ---------------------------------------------------------------------------

describe("company --verbose mode", () => {
  const richCompany = {
    id: "co_123",
    name: "Acme Corp",
    viewer_permissions: { can_send_message: false },
    description: "A company description",
    locations: [{ city: "Austin", country: "US", is_headquarter: true }],
  };

  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.profiles.getCompany as Mock).mockResolvedValue(richCompany);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--verbose returns full SDK response including viewer_permissions, locations array", async () => {
    const { runCompanyGet } = await import("../../src/commands/company.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runCompanyGet(
      client as never,
      { id: "acme-corp", account: "acc_1", json: true, verbose: true } as CompanyArgs,
      out,
    );

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as Record<string, unknown>;
    expect(result).toHaveProperty("viewer_permissions");
    expect(result).toHaveProperty("description");
    expect(result).toHaveProperty("locations");
  });
});
