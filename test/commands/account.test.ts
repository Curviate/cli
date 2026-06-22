/**
 * Tests for the `account` command group (root-scoped).
 *
 * Covers:
 *   account list         — accounts.list() + --all pagination
 *   account get          — accounts.get()
 *   account link         — accounts.link() body-flag + required flags + --preview
 *   account connect-link — accounts.createConnectLink() + --preview
 *   account reconnect    — accounts.reconnect() body-flag + required flags + --preview
 *   account refresh      — accounts.refresh() + --preview
 *   account update       — accounts.update() + --preview
 *   account disconnect   — accounts.disconnect() + --preview
 *   account checkpoint submit — accounts.submitCheckpoint() body-addressed + --preview
 *   account checkpoint poll   — accounts.pollCheckpoint() body-addressed + --preview
 *
 * All methods are root-scoped: the client exposes `client.accounts.*` directly
 * (no `client.account(id)` wrapper for these). account_id positionals pass
 * through verbatim (no resolveIdentifier).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Client mock factory
// ---------------------------------------------------------------------------

function makeClient() {
  return {
    accounts: {
      list: vi.fn(),
      get: vi.fn(),
      link: vi.fn(),
      createConnectLink: vi.fn(),
      reconnect: vi.fn(),
      refresh: vi.fn(),
      update: vi.fn(),
      disconnect: vi.fn(),
      submitCheckpoint: vi.fn(),
      pollCheckpoint: vi.fn(),
    },
  };
}

type Client = ReturnType<typeof makeClient>;

type AccountFlags = {
  "account-id"?: string;
  "seat-id"?: string;
  "auth-method"?: string;
  email?: string;
  password?: string;
  "li-at"?: string;
  "li-a"?: string;
  country?: string;
  ip?: string;
  "proxy-protocol"?: string;
  "proxy-host"?: string;
  "proxy-port"?: string;
  "proxy-username"?: string;
  "proxy-password"?: string;
  "user-agent"?: string;
  "recruiter-contract-id"?: string;
  purpose?: string;
  "expires-in-seconds"?: string;
  "redirect-url"?: string;
  checkpoint?: string;
  code?: string;
  name?: string;
  "request-url"?: string;
  "account-ids"?: string;
  enabled?: boolean;
  events?: string;
  format?: string;
  json?: boolean;
  all?: boolean;
  "max-pages"?: string;
  limit?: string;
  cursor?: string;
  fields?: string;
  preview?: boolean;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
};

function makeOut() {
  return {
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// account list
// ---------------------------------------------------------------------------

describe("account list", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.list as Mock).mockResolvedValue({ items: [{ account_id: "acc_1" }], cursor: null });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls accounts.list() with no params by default", async () => {
    const { runAccountList } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountList(client as never, { json: true } as AccountFlags, out);
    expect(client.accounts.list).toHaveBeenCalledWith({});
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(JSON.parse(written)).toHaveProperty("items");
  });

  it("passes limit and cursor", async () => {
    const { runAccountList } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountList(client as never, { json: true, limit: "5", cursor: "tok_abc" } as AccountFlags, out);
    expect(client.accounts.list).toHaveBeenCalledWith({ limit: 5, cursor: "tok_abc" });
  });

  it("--all streams NDJSON over two pages", async () => {
    const { runAccountList } = await import("../../src/commands/account.js");
    const out = makeOut();
    (client.accounts.list as Mock)
      .mockResolvedValueOnce({ items: [{ account_id: "acc_1" }, { account_id: "acc_2" }], cursor: "c1" })
      .mockResolvedValueOnce({ items: [{ account_id: "acc_3" }], cursor: null });

    await runAccountList(client as never, { all: true } as AccountFlags, out);

    const lines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const ndjson = lines.filter((l) => l.trim().startsWith("{"));
    expect(ndjson).toHaveLength(3);
    expect(JSON.parse(ndjson[0]!)).toEqual({ account_id: "acc_1" });
    expect(JSON.parse(ndjson[2]!)).toEqual({ account_id: "acc_3" });
  });

  it("--preview on a read command exits 2", async () => {
    const { runAccountList } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runAccountList(client as never, { preview: true } as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// account get
// ---------------------------------------------------------------------------

describe("account get", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.get as Mock).mockResolvedValue({ object: "account", account_id: "acc_42" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls accounts.get with verbatim account_id", async () => {
    const { runAccountGet } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountGet(client as never, { "account-id": "acc_42", json: true } as AccountFlags, out);
    expect(client.accounts.get).toHaveBeenCalledWith("acc_42");
  });

  it("account_id is NOT URL-resolved (pass through verbatim)", async () => {
    const { runAccountGet } = await import("../../src/commands/account.js");
    const out = makeOut();
    // Weird value — should pass through unchanged, not normalized
    await runAccountGet(client as never, { "account-id": "acc_abc123", json: true } as AccountFlags, out);
    expect(client.accounts.get).toHaveBeenCalledWith("acc_abc123");
  });

  it("--preview on a read command exits 2", async () => {
    const { runAccountGet } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runAccountGet(client as never, { "account-id": "acc_1", preview: true } as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// account link
// ---------------------------------------------------------------------------

describe("account link", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.link as Mock).mockResolvedValue({ object: "account", account_id: "acc_new" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls accounts.link with required body fields (credentials method)", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountLink(client as never, {
      "seat-id": "seat_1",
      "auth-method": "credentials",
      email: "user@example.com",
      password: "secret",
      json: true,
    } as AccountFlags, out);

    expect(client.accounts.link).toHaveBeenCalledWith(
      expect.objectContaining({
        seat_id: "seat_1",
        auth_method: "credentials",
        credentials: { email: "user@example.com", password: "secret" },
      }),
    );
  });

  it("calls accounts.link with cookie method", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountLink(client as never, {
      "seat-id": "seat_1",
      "auth-method": "cookie",
      "li-at": "li_at_value",
      json: true,
    } as AccountFlags, out);

    expect(client.accounts.link).toHaveBeenCalledWith(
      expect.objectContaining({
        seat_id: "seat_1",
        auth_method: "cookie",
        cookie: expect.objectContaining({ li_at: "li_at_value" }),
      }),
    );
  });

  it("missing --seat-id exits 2", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runAccountLink(client as never, { "auth-method": "cookie", "li-at": "val" } as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.link).not.toHaveBeenCalled();
  });

  it("missing --auth-method exits 2", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runAccountLink(client as never, { "seat-id": "seat_1" } as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.link).not.toHaveBeenCalled();
  });

  it("--preview renders request, does not call accounts.link", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountLink(client as never, {
      "seat-id": "seat_1",
      "auth-method": "cookie",
      "li-at": "li_at_value",
      preview: true,
    } as AccountFlags, out);

    expect(client.accounts.link).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("accounts.link");
  });
});

// ---------------------------------------------------------------------------
// account connect-link
// ---------------------------------------------------------------------------

describe("account connect-link", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.createConnectLink as Mock).mockResolvedValue({ object: "hosted_auth_url", url: "https://example.com/auth" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls accounts.createConnectLink with body", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountConnectLink(client as never, {
      "seat-id": "seat_1",
      purpose: "create",
      json: true,
    } as AccountFlags, out);

    expect(client.accounts.createConnectLink).toHaveBeenCalledWith(
      expect.objectContaining({ seat_id: "seat_1", purpose: "create" }),
    );
  });

  it("--preview renders request without calling createConnectLink", async () => {
    const { runAccountConnectLink } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountConnectLink(client as never, {
      "seat-id": "seat_1",
      preview: true,
    } as AccountFlags, out);

    expect(client.accounts.createConnectLink).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("accounts.createConnectLink");
  });
});

// ---------------------------------------------------------------------------
// account reconnect
// ---------------------------------------------------------------------------

describe("account reconnect", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.reconnect as Mock).mockResolvedValue({ object: "account", account_id: "acc_1" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls accounts.reconnect with account_id path arg verbatim + body", async () => {
    const { runAccountReconnect } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountReconnect(client as never, {
      "account-id": "acc_1",
      "auth-method": "cookie",
      "li-at": "li_at_value",
      json: true,
    } as AccountFlags, out);

    expect(client.accounts.reconnect).toHaveBeenCalledWith(
      "acc_1",
      expect.objectContaining({ auth_method: "cookie" }),
    );
  });

  it("missing --auth-method exits 2", async () => {
    const { runAccountReconnect } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runAccountReconnect(client as never, { "account-id": "acc_1" } as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.reconnect).not.toHaveBeenCalled();
  });

  it("--preview renders request without calling reconnect", async () => {
    const { runAccountReconnect } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountReconnect(client as never, {
      "account-id": "acc_1",
      "auth-method": "cookie",
      "li-at": "val",
      preview: true,
    } as AccountFlags, out);

    expect(client.accounts.reconnect).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("accounts.reconnect");
    expect(parsed.args).toHaveProperty("accountId", "acc_1");
  });
});

// ---------------------------------------------------------------------------
// account refresh
// ---------------------------------------------------------------------------

describe("account refresh", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.refresh as Mock).mockResolvedValue({ object: "account", account_id: "acc_1" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls accounts.refresh with verbatim account_id", async () => {
    const { runAccountRefresh } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountRefresh(client as never, { "account-id": "acc_1", json: true } as AccountFlags, out);
    expect(client.accounts.refresh).toHaveBeenCalledWith("acc_1");
  });

  it("--preview renders request without calling refresh", async () => {
    const { runAccountRefresh } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountRefresh(client as never, { "account-id": "acc_1", preview: true } as AccountFlags, out);
    expect(client.accounts.refresh).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("accounts.refresh");
  });
});

// ---------------------------------------------------------------------------
// account update
// ---------------------------------------------------------------------------

describe("account update", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.update as Mock).mockResolvedValue({ object: "account", account_id: "acc_1" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls accounts.update with account_id and body", async () => {
    const { runAccountUpdate } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountUpdate(client as never, {
      "account-id": "acc_1",
      country: "DE",
      json: true,
    } as AccountFlags, out);

    expect(client.accounts.update).toHaveBeenCalledWith(
      "acc_1",
      expect.objectContaining({ country: "DE" }),
    );
  });

  it("--preview renders request without calling update", async () => {
    const { runAccountUpdate } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountUpdate(client as never, {
      "account-id": "acc_1",
      country: "US",
      preview: true,
    } as AccountFlags, out);

    expect(client.accounts.update).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("accounts.update");
    expect(parsed.args).toHaveProperty("accountId", "acc_1");
  });
});

// ---------------------------------------------------------------------------
// account disconnect
// ---------------------------------------------------------------------------

describe("account disconnect", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.disconnect as Mock).mockResolvedValue({ object: "account_disconnected", account_id: "acc_1" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls accounts.disconnect with verbatim account_id", async () => {
    const { runAccountDisconnect } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountDisconnect(client as never, { "account-id": "acc_1", json: true } as AccountFlags, out);
    expect(client.accounts.disconnect).toHaveBeenCalledWith("acc_1");
  });

  it("--preview renders request without calling disconnect", async () => {
    const { runAccountDisconnect } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountDisconnect(client as never, { "account-id": "acc_1", preview: true } as AccountFlags, out);
    expect(client.accounts.disconnect).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("accounts.disconnect");
  });
});

// ---------------------------------------------------------------------------
// account checkpoint submit (body-addressed — no path positional for checkpoint id)
// ---------------------------------------------------------------------------

describe("account checkpoint submit", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.submitCheckpoint as Mock).mockResolvedValue({ object: "account", status: "active" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("checkpoint id goes into the body (body-addressed), not a path arg", async () => {
    const { runAccountCheckpointSubmit } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountCheckpointSubmit(client as never, {
      checkpoint: "acc_pending_1",
      code: "123456",
      json: true,
    } as AccountFlags, out);

    // The SDK method signature is submitCheckpoint(body) — body carries account_id + code
    expect(client.accounts.submitCheckpoint).toHaveBeenCalledWith({
      account_id: "acc_pending_1",
      code: "123456",
    });
  });

  it("missing --checkpoint exits 2", async () => {
    const { runAccountCheckpointSubmit } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runAccountCheckpointSubmit(client as never, { code: "123456" } as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.submitCheckpoint).not.toHaveBeenCalled();
  });

  it("missing --code exits 2", async () => {
    const { runAccountCheckpointSubmit } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runAccountCheckpointSubmit(client as never, { checkpoint: "acc_1" } as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.submitCheckpoint).not.toHaveBeenCalled();
  });

  it("--preview renders without calling submitCheckpoint", async () => {
    const { runAccountCheckpointSubmit } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountCheckpointSubmit(client as never, {
      checkpoint: "acc_pending_1",
      code: "654321",
      preview: true,
    } as AccountFlags, out);

    expect(client.accounts.submitCheckpoint).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("accounts.submitCheckpoint");
    // Body should show checkpoint id and code
    expect(parsed.body).toHaveProperty("account_id", "acc_pending_1");
    expect(parsed.body).toHaveProperty("code", "654321");
  });
});

// ---------------------------------------------------------------------------
// account checkpoint poll (body-addressed)
// ---------------------------------------------------------------------------

describe("account checkpoint poll", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
    (client.accounts.pollCheckpoint as Mock).mockResolvedValue({ object: "checkpoint", status: "pending" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("checkpoint id goes into the body (body-addressed)", async () => {
    const { runAccountCheckpointPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountCheckpointPoll(client as never, {
      checkpoint: "acc_pending_1",
      json: true,
    } as AccountFlags, out);

    expect(client.accounts.pollCheckpoint).toHaveBeenCalledWith({
      account_id: "acc_pending_1",
    });
  });

  it("missing --checkpoint exits 2", async () => {
    const { runAccountCheckpointPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runAccountCheckpointPoll(client as never, {} as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.accounts.pollCheckpoint).not.toHaveBeenCalled();
  });

  it("--preview renders without calling pollCheckpoint", async () => {
    const { runAccountCheckpointPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    await runAccountCheckpointPoll(client as never, {
      checkpoint: "acc_pending_1",
      preview: true,
    } as AccountFlags, out);

    expect(client.accounts.pollCheckpoint).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("accounts.pollCheckpoint");
    expect(parsed.body).toHaveProperty("account_id", "acc_pending_1");
  });
});
