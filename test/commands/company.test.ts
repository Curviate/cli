/**
 * Tests for the `company` command group.
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
