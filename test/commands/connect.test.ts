/**
 * Tests for the `connect` command group.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeAccountNs() {
  return {
    invites: {
      send: vi.fn(),
      listSent: vi.fn(),
      listReceived: vi.fn(),
      respond: vi.fn(),
      cancel: vi.fn(),
    },
  };
}

function makeClient(accountNs: ReturnType<typeof makeAccountNs>) {
  return {
    account: vi.fn().mockReturnValue(accountNs),
  };
}

type ConnectArgs = {
  id?: string;
  note?: string;
  action?: string;
  "shared-secret"?: string;
  account?: string;
  json?: boolean;
  preview?: boolean;
  all?: boolean;
  "max-pages"?: string;
  limit?: string;
  cursor?: string;
  fields?: string;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
  verbose?: boolean;
};

describe("connect <id> — send invitation", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.invites.send as Mock).mockResolvedValue({ status: "sent" });
    (accountNs.invites.listSent as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.invites.listReceived as Mock).mockResolvedValue({ items: [], cursor: null });
    (accountNs.invites.respond as Mock).mockResolvedValue({ status: "accepted" });
    (accountNs.invites.cancel as Mock).mockResolvedValue({ status: "cancelled" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connect <member-url> — resolves URL to slug, calls invites.send", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, {
      id: "https://www.linkedin.com/in/jdoe/?trk=x",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(accountNs.invites.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_identifier: "jdoe" }),
    );
  });

  it("connect bare slug — passes slug unchanged", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, { id: "jdoe", account: "acc_1", json: true } as ConnectArgs, out);

    expect(accountNs.invites.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_identifier: "jdoe" }),
    );
  });

  it("connect URN — passes URN unchanged", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, {
      id: "urn:li:fsd_profile:ABC123",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_identifier: "urn:li:fsd_profile:ABC123" }),
    );
  });

  it("connect <id> --note <text> — passes message field", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, {
      id: "jdoe",
      note: "Hello!",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_identifier: "jdoe", message: "Hello!" }),
    );
  });

  it("connect --preview — renders preview, does not call send", async () => {
    const { runConnectSend } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSend(client as never, {
      id: "jdoe",
      account: "acc_1",
      preview: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.send).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("invites.send");
  });
});

describe("connect sent / received — list reads", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.invites.listSent as Mock).mockResolvedValue({ items: [{ id: "s1" }], cursor: null });
    (accountNs.invites.listReceived as Mock).mockResolvedValue({ items: [{ id: "r1" }], cursor: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connect sent — calls invites.listSent", async () => {
    const { runConnectSent } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSent(client as never, { account: "acc_1", json: true } as ConnectArgs, out);

    expect(accountNs.invites.listSent).toHaveBeenCalled();
  });

  it("connect sent --preview → usage error exit 2", async () => {
    const { runConnectSent } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => { throw new Error(`process.exit(${code})`); });
    try {
      await runConnectSent(client as never, { account: "acc_1", preview: true } as ConnectArgs, out);
      expect.fail("Should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("connect received — calls invites.listReceived", async () => {
    const { runConnectReceived } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectReceived(client as never, { account: "acc_1", json: true } as ConnectArgs, out);

    expect(accountNs.invites.listReceived).toHaveBeenCalled();
  });

  it("connect received --all — streams NDJSON", async () => {
    const { runConnectReceived } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    (accountNs.invites.listReceived as Mock)
      .mockResolvedValueOnce({ items: [{ id: "r1" }, { id: "r2" }], cursor: "c1" })
      .mockResolvedValueOnce({ items: [{ id: "r3" }], cursor: null });

    await runConnectReceived(client as never, { account: "acc_1", all: true } as ConnectArgs, out);

    const writtenLines = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string);
    const ndjsonLines = writtenLines.filter((l) => l.trim().startsWith("{"));
    expect(ndjsonLines).toHaveLength(3);
  });
});

describe("connect respond / cancel — writes, invitation_id NOT resolved", () => {
  let accountNs: ReturnType<typeof makeAccountNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    accountNs = makeAccountNs();
    client = makeClient(accountNs);
    (accountNs.invites.respond as Mock).mockResolvedValue({ status: "accepted" });
    (accountNs.invites.cancel as Mock).mockResolvedValue({ status: "cancelled" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connect respond <id> --action accept --shared-secret <s> — calls respond with verbatim id", async () => {
    const { runConnectRespond } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectRespond(client as never, {
      id: "inv_123",
      action: "accept",
      "shared-secret": "tok_abc",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.respond).toHaveBeenCalledWith("inv_123", {
      action: "accept",
      shared_secret: "tok_abc",
    });
  });

  // ── Wire-encoding regression: the body MUST carry both required fields.
  // OpenAPI required = [account_id, action, shared_secret]. account_id rides
  // via client.account(id); action + shared_secret are the request body.
  // A prior version sent {action} only → guaranteed API 400.
  it("connect respond — body carries both action and shared_secret (every required field)", async () => {
    const { runConnectRespond } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectRespond(client as never, {
      id: "inv_999",
      action: "decline",
      "shared-secret": "tok_xyz",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    const [id, body] = (accountNs.invites.respond as Mock).mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe("inv_999");
    expect(body).toEqual({ action: "decline", shared_secret: "tok_xyz" });
  });

  it("connect respond — missing --shared-secret exits 2 before any SDK call", async () => {
    const { runConnectRespond } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await runConnectRespond(client as never, {
        id: "inv_123",
        action: "accept",
        account: "acc_1",
      } as ConnectArgs, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(accountNs.invites.respond).not.toHaveBeenCalled();
  });

  it("connect respond --preview — renders preview (with shared_secret) without calling respond", async () => {
    const { runConnectRespond } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectRespond(client as never, {
      id: "inv_123",
      action: "accept",
      "shared-secret": "tok_abc",
      account: "acc_1",
      preview: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.respond).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("invites.respond");
    // Preview must be honest: the assembled body includes shared_secret.
    expect(parsed.body).toEqual({ action: "accept", shared_secret: "tok_abc" });
  });

  it("connect cancel <id> — calls cancel with verbatim id (not URL-resolved)", async () => {
    const { runConnectCancel } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    // invitation_id could look like a URL-ish string but must NOT be resolved
    await runConnectCancel(client as never, {
      id: "inv_abc",
      account: "acc_1",
      json: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.cancel).toHaveBeenCalledWith("inv_abc");
  });

  it("connect cancel --preview — renders preview without calling cancel", async () => {
    const { runConnectCancel } = await import("../../src/commands/connect.js");
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectCancel(client as never, {
      id: "inv_abc",
      account: "acc_1",
      preview: true,
    } as ConnectArgs, out);

    expect(accountNs.invites.cancel).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("invites.cancel");
  });
});

// ---------------------------------------------------------------------------
// Pagination flag suppression on write commands
// ---------------------------------------------------------------------------

const PAGINATION_FLAGS = ["limit", "cursor", "all", "max-pages", "fields"] as const;

describe("connect write commands — no pagination flags in args definition", () => {
  it("connect (send root) — args definition has no pagination/projection flags", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const args = (connectCommand as Record<string, unknown>).args as Record<string, unknown>;
    for (const flag of PAGINATION_FLAGS) {
      expect(args, `connect root args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("connect respond — args definition has no pagination/projection flags", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, unknown> }
    >;
    const respondArgs = subCmds["respond"]?.args ?? {};
    for (const flag of PAGINATION_FLAGS) {
      expect(respondArgs, `connect respond args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("connect cancel — args definition has no pagination/projection flags", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, unknown> }
    >;
    const cancelArgs = subCmds["cancel"]?.args ?? {};
    for (const flag of PAGINATION_FLAGS) {
      expect(cancelArgs, `connect cancel args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
  });

  it("connect sent — args definition DOES have pagination flags (list read, negative control)", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, unknown> }
    >;
    const sentArgs = subCmds["sent"]?.args ?? {};
    expect(sentArgs, "connect sent must have --limit").toHaveProperty("limit");
    expect(sentArgs, "connect sent must have --cursor").toHaveProperty("cursor");
    expect(sentArgs, "connect sent must have --all").toHaveProperty("all");
  });

  it("connect received — args definition DOES have pagination flags (list read, negative control)", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, unknown> }
    >;
    const receivedArgs = subCmds["received"]?.args ?? {};
    expect(receivedArgs, "connect received must have --limit").toHaveProperty("limit");
    expect(receivedArgs, "connect received must have --cursor").toHaveProperty("cursor");
    expect(receivedArgs, "connect received must have --all").toHaveProperty("all");
  });
});

// ---------------------------------------------------------------------------
// connect sent slim default
// ---------------------------------------------------------------------------

const SENT_STUB = {
  object: "invitation_list",
  items: [
    {
      id: "inv_1",
      invited_user: "jdoe",
      invited_user_id: "123",
      invited_user_public_id: "jdoe",
      invited_user_description: "Engineer",
      date: "2026-01-01",
      parsed_datetime: "2026-01-01T00:00:00Z",
      invitation_text: "Hi!",
      inviter: {
        inviter_name: "Raph",
        inviter_id: "789",
        inviter_public_identifier: "raphael-redmer",
        inviter_description: null,
      },
      specifics: { provider: "LINKEDIN", shared_secret: null },
    },
  ],
  cursor: null,
};

describe("connect sent slim default", () => {
  it("slim mode drops inviter and specifics, keeps required fields", async () => {
    const { runConnectSent } = await import("../../src/commands/connect.js");
    const ns = {
      invites: {
        listSent: vi.fn().mockResolvedValue(SENT_STUB),
        listReceived: vi.fn(),
        send: vi.fn(),
        respond: vi.fn(),
        cancel: vi.fn(),
      },
    };
    const client = { account: vi.fn().mockReturnValue(ns) };
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSent(client as never, { account: "acc_A", json: true } as ConnectArgs, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Record<string, unknown>[] };
    const item = result.items[0]!;

    expect(item).toHaveProperty("id", "inv_1");
    expect(item).toHaveProperty("invited_user", "jdoe");
    expect(item).toHaveProperty("invited_user_id", "123");
    expect(item).toHaveProperty("invited_user_public_id", "jdoe");
    expect(item).toHaveProperty("invited_user_description", "Engineer");
    expect(item).toHaveProperty("date", "2026-01-01");
    expect(item).toHaveProperty("parsed_datetime", "2026-01-01T00:00:00Z");
    expect(item).toHaveProperty("invitation_text", "Hi!");
    expect(item).not.toHaveProperty("inviter");
    expect(item).not.toHaveProperty("specifics");
  });

  it("--verbose restores inviter and specifics to full server response", async () => {
    const { runConnectSent } = await import("../../src/commands/connect.js");
    const ns = {
      invites: {
        listSent: vi.fn().mockResolvedValue(SENT_STUB),
        listReceived: vi.fn(),
        send: vi.fn(),
        respond: vi.fn(),
        cancel: vi.fn(),
      },
    };
    const client = { account: vi.fn().mockReturnValue(ns) };
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectSent(
      client as never,
      { account: "acc_A", json: true, verbose: true } as ConnectArgs,
      out,
    );

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Record<string, unknown>[] };
    const item = result.items[0]!;

    expect(item).toHaveProperty("inviter");
    const inviter = item["inviter"] as Record<string, unknown>;
    expect(inviter["inviter_name"]).toBe("Raph");
    expect(item).toHaveProperty("specifics");
    const specifics = item["specifics"] as Record<string, unknown>;
    expect(specifics["provider"]).toBe("LINKEDIN");
    expect(specifics["shared_secret"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// connect received slim default
// ---------------------------------------------------------------------------

const RECEIVED_STUB = {
  object: "invitation_list",
  items: [
    {
      id: "inv_2",
      invited_user: "me",
      invited_user_id: "self_123",
      invited_user_public_id: "raphael-redmer",
      invited_user_description: null,
      date: "2026-01-01",
      parsed_datetime: "2026-01-01T00:00:00Z",
      invitation_text: "Let's connect!",
      inviter: {
        inviter_name: "Jane",
        inviter_id: "456",
        inviter_public_identifier: "jane-doe",
        inviter_description: "Engineer",
      },
      specifics: { provider: "LINKEDIN", shared_secret: "SEC_123" },
    },
  ],
  cursor: null,
};

describe("connect received slim default", () => {
  it("slim mode drops self-referential invited_user fields, projects specifics to shared_secret only", async () => {
    const { runConnectReceived } = await import("../../src/commands/connect.js");
    const ns = {
      invites: {
        listReceived: vi.fn().mockResolvedValue(RECEIVED_STUB),
        listSent: vi.fn(),
        send: vi.fn(),
        respond: vi.fn(),
        cancel: vi.fn(),
      },
    };
    const client = { account: vi.fn().mockReturnValue(ns) };
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectReceived(
      client as never,
      { account: "acc_A", json: true } as ConnectArgs,
      out,
    );

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Record<string, unknown>[] };
    const item = result.items[0]!;

    expect(item).not.toHaveProperty("invited_user");
    expect(item).not.toHaveProperty("invited_user_id");
    expect(item).not.toHaveProperty("invited_user_public_id");
    expect(item).not.toHaveProperty("invited_user_description");

    expect(item).toHaveProperty("id", "inv_2");
    const inviter = item["inviter"] as Record<string, unknown>;
    expect(inviter["inviter_name"]).toBe("Jane");
    expect(inviter["inviter_id"]).toBe("456");
    expect(inviter["inviter_public_identifier"]).toBe("jane-doe");
    expect(inviter["inviter_description"]).toBe("Engineer");

    expect(item).toHaveProperty("specifics");
    const specifics = item["specifics"] as Record<string, unknown>;
    expect(specifics["shared_secret"]).toBe("SEC_123");
    expect(specifics).not.toHaveProperty("provider");
  });

  it("--verbose restores invited_user fields and full specifics including provider", async () => {
    const { runConnectReceived } = await import("../../src/commands/connect.js");
    const ns = {
      invites: {
        listReceived: vi.fn().mockResolvedValue(RECEIVED_STUB),
        listSent: vi.fn(),
        send: vi.fn(),
        respond: vi.fn(),
        cancel: vi.fn(),
      },
    };
    const client = { account: vi.fn().mockReturnValue(ns) };
    const out = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };

    await runConnectReceived(
      client as never,
      { account: "acc_A", json: true, verbose: true } as ConnectArgs,
      out,
    );

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const result = JSON.parse(written) as { items: Record<string, unknown>[] };
    const item = result.items[0]!;

    expect(item["invited_user"]).toBe("me");
    const specifics = item["specifics"] as Record<string, unknown>;
    expect(specifics["provider"]).toBe("LINKEDIN");
  });
});

// ---------------------------------------------------------------------------
// Help string assertions — Tier-1 (exact strings)
// ---------------------------------------------------------------------------

describe("connect help strings — Tier-1", () => {
  it("connect (send) positional description contains provider_id", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const args = (connectCommand as Record<string, unknown>).args as Record<
      string,
      { description?: string }
    >;
    const desc = args["id"]?.description ?? "";
    expect(desc).toContain("provider_id");
  });

  it("connect --note description mentions acceptance rates and char limit", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const args = (connectCommand as Record<string, unknown>).args as Record<
      string,
      { description?: string }
    >;
    const desc = args["note"]?.description ?? "";
    expect(desc).toContain("Personalized messages increase acceptance rates");
    expect(desc).toMatch(/300 char|≤300 char/);
  });

  it("connect sent description contains pending and connect cancel cross-reference", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { meta?: { description?: string } }
    >;
    const desc = subCmds["sent"]?.meta?.description ?? "";
    expect(desc).toContain("pending");
    expect(desc).toContain("connect cancel");
  });

  it("connect received description contains pending, already-handled, and specifics.shared_secret", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { meta?: { description?: string } }
    >;
    const desc = subCmds["received"]?.meta?.description ?? "";
    expect(desc).toContain("pending");
    expect(desc).toContain("already-handled");
    expect(desc).toContain("specifics.shared_secret");
  });

  it("connect respond positional id description references connect received as source", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, { description?: string }> }
    >;
    const desc = subCmds["respond"]?.args?.["id"]?.description ?? "";
    expect(desc).toContain("connect received");
  });

  it("connect respond --shared-secret description references specifics.shared_secret from connect received", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { args?: Record<string, { description?: string }> }
    >;
    const desc = subCmds["respond"]?.args?.["shared-secret"]?.description ?? "";
    expect(desc).toContain("specifics.shared_secret");
    expect(desc).toContain("connect received");
  });
});

// ---------------------------------------------------------------------------
// Help string assertions — Tier-2 (additional doc strings)
// ---------------------------------------------------------------------------

describe("connect help strings — Tier-2 additional doc strings", () => {
  it("connect sent description contains parsed_datetime with approximation caveat", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { meta?: { description?: string } }
    >;
    const desc = subCmds["sent"]?.meta?.description ?? "";
    expect(desc).toContain("parsed_datetime");
    expect(desc.toLowerCase()).toMatch(/approximate|derived from/);
  });

  it("connect sent description contains no-total-count workaround hint", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const subCmds = (connectCommand as Record<string, unknown>).subCommands as Record<
      string,
      { meta?: { description?: string } }
    >;
    const desc = subCmds["sent"]?.meta?.description ?? "";
    expect(desc.toLowerCase()).toMatch(/no total count|count client-side/);
  });

  it("connect command description contains propagation delay note with 10-30 seconds", async () => {
    const { connectCommand } = await import("../../src/commands/connect.js");
    const meta = (connectCommand as Record<string, unknown>).meta as { description?: string };
    const desc = meta?.description ?? "";
    expect(desc).toMatch(/10.{0,5}30 seconds|propagation/i);
  });
});
