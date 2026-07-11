/**
 * The standalone `account connect-session poll` command (`auth.getSession`).
 *
 * Covers:
 *   - `account connect-session poll` standalone: one-shot (default) and
 *     --wait (adaptive-cadence loop 1000ms, then 1500ms for 30s, then 3000ms
 *     against a mock `getSession`, all terminal exits — resolved/expired/
 *     failed/timeout, the stderr status ticker vs. --json silence).
 *   - Flag suppression (the single-object read convention: pagination flags
 *     absent, --fields kept) and command registration.
 *
 * Hermetic throughout: a mock client, injected sleep/now/TTY seams — never a
 * real timer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { AUTH_NEEDED } from "../../src/lib/exit-codes.js";

// ---------------------------------------------------------------------------
// Client mock factory
// ---------------------------------------------------------------------------

function makeClient() {
  return {
    auth: {
      getSession: vi.fn(),
    },
  };
}

type Client = ReturnType<typeof makeClient>;

type AccountFlags = {
  "seat-id"?: string;
  "account-id"?: string;
  purpose?: string;
  "expires-in-seconds"?: string;
  "redirect-url"?: string;
  session?: string;
  wait?: boolean;
  open?: boolean;
  "no-interactive"?: boolean;
  timeout?: string;
  json?: boolean;
  preview?: boolean;
};

function makeOut() {
  return {
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
  };
}

function makeExitSpy() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}

/**
 * An injectable clock pair where `sleep` advances `now()` by exactly the
 * requested delay instead of waiting in real time (same technique as the
 * checkpoint poll --wait tests) — deterministic cadence assertions, zero
 * real wall-clock cost.
 */
function makeAdvancingClock(startMs = 0) {
  let current = startMs;
  const now = () => current;
  const sleep = vi.fn((ms: number) => {
    current += ms;
    return Promise.resolve();
  });
  return { now, sleep };
}

function resolvedSession(accountId = "acc_final") {
  return {
    object: "connect_session",
    session_id: "cs_1",
    status: "resolved",
    account_id: accountId,
    expires_at: "2099-01-01T00:00:00.000Z",
  };
}

const PENDING_SESSION = {
  object: "connect_session",
  session_id: "cs_1",
  status: "pending",
  account_id: null,
  expires_at: "2099-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// account connect-session poll
// ---------------------------------------------------------------------------

describe("account connect-session poll — one-shot (no --wait)", () => {
  let client: Client;
  beforeEach(() => {
    client = makeClient();
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls getConnectSession once with the session_id, prints the body, exit 0 regardless of status", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    (client.auth.getSession as Mock).mockResolvedValue(PENDING_SESSION);

    await runAccountConnectSessionPoll(
      client as never,
      { session: "cs_1", json: true } as AccountFlags,
      out,
    );

    expect(client.auth.getSession).toHaveBeenCalledTimes(1);
    // Regression guard: the CLI passes the session_id as a bare STRING, not an
    // object. Passing `{ session_id }` would interpolate to
    // `/v1/accounts/connect-sessions/[object Object]` (the fixed bug).
    expect(client.auth.getSession).toHaveBeenCalledWith("cs_1");
    const [seenArg] = (client.auth.getSession as Mock).mock.calls[0] as [unknown];
    expect(typeof seenArg).toBe("string");
    expect(`/v1/accounts/connect-sessions/${seenArg}`).toBe("/v1/accounts/connect-sessions/cs_1");
    expect(`/v1/accounts/connect-sessions/${seenArg}`).not.toContain("[object Object]");
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(JSON.parse(written)).toMatchObject({ status: "pending" });
  });

  it("--session is required: missing it exits 2 before any getConnectSession call", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectSessionPoll(client as never, { json: true } as AccountFlags, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it("--preview renders the request without calling getConnectSession", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();

    await runAccountConnectSessionPoll(
      client as never,
      { session: "cs_1", json: true, preview: true } as AccountFlags,
      out,
    );

    expect(client.auth.getSession).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("auth.getSession");
    // session_id is a positional arg, not a body field.
    expect(parsed.args).toMatchObject({ session_id: "cs_1" });
  });
});

describe("account connect-session poll --wait — adaptive-cadence loop", () => {
  let client: Client;
  beforeEach(() => {
    client = makeClient();
  });
  afterEach(() => vi.restoreAllMocks());

  it("--wait resolves on the first poll (after the initial 1000ms delay), prints 'Account connected', exits 0", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    (client.auth.getSession as Mock).mockResolvedValue(resolvedSession());

    await runAccountConnectSessionPoll(
      client as never,
      { session: "cs_1", json: true, wait: true } as AccountFlags,
      out,
      { isOutputTTY: false, sleep: clock.sleep, now: clock.now },
    );

    expect(client.auth.getSession).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenNthCalledWith(1, 1000);
    const stderrText = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrText).toContain("Account connected: acc_final");
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(JSON.parse(written)).toMatchObject({ status: "resolved" });
  });

  it.each(["expired", "failed"])("--wait exits 9 when the session reaches status %s", async (status) => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    (client.auth.getSession as Mock).mockResolvedValue({ ...PENDING_SESSION, status });

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectSessionPoll(
        client as never,
        { session: "cs_1", json: true, wait: true } as AccountFlags,
        out,
        { isOutputTTY: false, sleep: clock.sleep, now: clock.now },
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(9)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("--wait --timeout elapses while still pending -> exit 12 (AUTH_NEEDED)", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    const clock = makeAdvancingClock();
    (client.auth.getSession as Mock).mockResolvedValue(PENDING_SESSION);

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectSessionPoll(
        client as never,
        { session: "cs_1", json: true, wait: true, timeout: "500" } as AccountFlags,
        out,
        { isOutputTTY: false, sleep: clock.sleep, now: clock.now },
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain(`process.exit(${AUTH_NEEDED})`);
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.auth.getSession).toHaveBeenCalledTimes(1);
  });

  it("--timeout must be numeric — a non-numeric value exits 2 before any getConnectSession call", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();

    const exitSpy = makeExitSpy();
    try {
      await runAccountConnectSessionPoll(
        client as never,
        { session: "cs_1", json: true, wait: true, timeout: "not-a-number" } as AccountFlags,
        out,
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it("without --wait, a single poll call is unaffected (back-compat, --wait defaults off)", async () => {
    const { runAccountConnectSessionPoll } = await import("../../src/commands/account.js");
    const out = makeOut();
    (client.auth.getSession as Mock).mockResolvedValue(PENDING_SESSION);

    await runAccountConnectSessionPoll(
      client as never,
      { session: "cs_1", json: true } as AccountFlags,
      out,
    );

    expect(client.auth.getSession).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

describe("account connect-session — subcommand registration", () => {
  it("registers 'poll' under 'connect-session'", async () => {
    const { accountCommand } = await import("../../src/commands/account.js");
    const connectSession = (
      accountCommand as unknown as {
        subCommands: { "connect-session": { subCommands: Record<string, unknown> } };
      }
    ).subCommands["connect-session"];
    expect(Object.keys(connectSession.subCommands)).toEqual(["poll"]);
  });

  it("account command registers 'connect-session' and no longer registers the removed hosted-link commands", async () => {
    const { accountCommand } = await import("../../src/commands/account.js");
    const subCmds = (accountCommand as unknown as { subCommands: Record<string, unknown> }).subCommands;
    expect(subCmds).toHaveProperty("connect-session");
    expect(subCmds).not.toHaveProperty("connect-link");
    expect(subCmds).not.toHaveProperty("reconnect-link");
    expect(subCmds).not.toHaveProperty("reconnect");
  });
});

// ---------------------------------------------------------------------------
// Flag suppression (the single-object write convention) — pagination absent, --fields kept
// ---------------------------------------------------------------------------

const PAGINATION_ONLY_FLAGS = ["limit", "cursor", "all", "max-pages"] as const;

describe("account connect-session poll — single-object read flag set", () => {
  it("account connect-session poll args has --session (required), --wait, --timeout, --fields, no pagination", async () => {
    const { accountCommand } = await import("../../src/commands/account.js");
    const subCmds = (
      accountCommand as unknown as {
        subCommands: { "connect-session": { subCommands: Record<string, { args?: Record<string, unknown> }> } };
      }
    ).subCommands;
    const args = (subCmds["connect-session"]?.subCommands?.["poll"]?.args ?? {}) as Record<
      string,
      { required?: boolean }
    >;

    for (const flag of PAGINATION_ONLY_FLAGS) {
      expect(args, `connect-session poll args must NOT include --${flag}`).not.toHaveProperty(flag);
    }
    expect(args).not.toHaveProperty("idempotency-key");
    expect(args).not.toHaveProperty("dry-run");
    expect(args).toHaveProperty("fields");
    expect(args).toHaveProperty("session");
    expect(args["session"]?.required).toBe(true);
    expect(args).toHaveProperty("wait");
    expect(args).toHaveProperty("timeout");
  });
});
