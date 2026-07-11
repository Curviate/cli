/**
 * LinkedIn-account credential-input safety: env-var fallbacks, the
 * `--*-stdin` flags, the stdin/flag conflict matrix, the masked TTY prompt +
 * non-TTY fail-fast, the `ps`/shell-history warnings on the value flags, and
 * the invariant that a resolved secret reaches only the SDK request body
 * (never stdout/stderr/`--json`/`--preview`/error output).
 *
 * Covers `account link`, `account reconnect`, `account update`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeClient() {
  return {
    accounts: {
      reconnect: vi.fn(),
      update: vi.fn(),
    },
    auth: {
      intent: vi.fn(),
    },
  };
}

function makeOut() {
  return { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
}

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}

const ENV_PASSWORD = "CURVIATE_LINKEDIN_PASSWORD";
const ENV_LI_AT = "CURVIATE_LINKEDIN_LI_AT";
const ENV_LI_A = "CURVIATE_LINKEDIN_LI_A";
const ENV_PROXY_PW = "CURVIATE_PROXY_PASSWORD";

function clearSecretEnv() {
  delete process.env[ENV_PASSWORD];
  delete process.env[ENV_LI_AT];
  delete process.env[ENV_LI_A];
  delete process.env[ENV_PROXY_PW];
}

// ---------------------------------------------------------------------------
// env-var precedence (flag > env), optional flag>env>omitted
// ---------------------------------------------------------------------------

describe("account credentials — env-var precedence", () => {
  afterEach(clearSecretEnv);

  it("password: flag beats env", async () => {
    process.env[ENV_PASSWORD] = "FROM_ENV";
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account", account_id: "acc_1" });
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", password: "FROM_FLAG", json: true } as never,
      out,
    );
    expect(client.auth.intent).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { email: "a@b.c", password: "FROM_FLAG" } }),
    );
  });

  it("password: env used when no flag", async () => {
    process.env[ENV_PASSWORD] = "FROM_ENV";
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account", account_id: "acc_1" });
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", json: true } as never,
      out,
    );
    expect(client.auth.intent).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { email: "a@b.c", password: "FROM_ENV" } }),
    );
  });

  it("password: an explicitly empty flag falls through to env, never sends an empty secret", async () => {
    process.env[ENV_PASSWORD] = "ENV_FALLBACK";
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", password: "", json: true } as never,
      out,
    );
    expect(client.auth.intent).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { email: "a@b.c", password: "ENV_FALLBACK" } }),
    );
  });

  it("li_at: flag beats env (reconnect)", async () => {
    process.env[ENV_LI_AT] = "ENV_LIAT";
    const { runAccountReconnect } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.accounts.reconnect as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountReconnect(
      client as never,
      { "account-id": "acc_1", "auth-method": "cookie", "user-agent": "UA", "li-at": "FLAG_LIAT", json: true } as never,
      out,
    );
    expect(client.accounts.reconnect).toHaveBeenCalledWith(
      "acc_1",
      expect.objectContaining({ cookie: { li_at: "FLAG_LIAT" } }),
    );
  });

  it("li_at: env used when no flag (reconnect)", async () => {
    process.env[ENV_LI_AT] = "ENV_LIAT";
    const { runAccountReconnect } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.accounts.reconnect as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountReconnect(
      client as never,
      { "account-id": "acc_1", "auth-method": "cookie", "user-agent": "UA", json: true } as never,
      out,
    );
    expect(client.accounts.reconnect).toHaveBeenCalledWith(
      "acc_1",
      expect.objectContaining({ cookie: { li_at: "ENV_LIAT" } }),
    );
  });

  it("li_a (optional): flag > env > omitted — flag wins when both set", async () => {
    process.env[ENV_LI_A] = "ENV_LIA";
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "cookie", "user-agent": "UA", "li-at": "AT", "li-a": "FLAG_LIA", json: true } as never,
      out,
    );
    expect(client.auth.intent).toHaveBeenCalledWith(
      expect.objectContaining({ cookie: { li_at: "AT", li_a: "FLAG_LIA" } }),
    );
  });

  it("li_a (optional): omitted entirely (not an empty field) when neither flag nor env set", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "cookie", "user-agent": "UA", "li-at": "AT", json: true } as never,
      out,
    );
    const body = (client.auth.intent as Mock).mock.calls[0]?.[0] as { cookie: Record<string, unknown> };
    expect(body.cookie).toEqual({ li_at: "AT" });
    expect(body.cookie).not.toHaveProperty("li_a");
  });

  it("proxy password (optional): flag > env > omitted, on account update", async () => {
    process.env[ENV_PROXY_PW] = "ENV_PROXY";
    const { runAccountUpdate } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.accounts.update as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountUpdate(
      client as never,
      { "account-id": "acc_1", "proxy-host": "proxy.example.com", json: true } as never,
      out,
    );
    expect(client.accounts.update).toHaveBeenCalledWith(
      "acc_1",
      expect.objectContaining({ proxy: expect.objectContaining({ password: "ENV_PROXY" }) }),
    );
  });

  it("proxy password (optional): omitted entirely when neither flag nor env set", async () => {
    const { runAccountUpdate } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.accounts.update as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountUpdate(
      client as never,
      { "account-id": "acc_1", "proxy-host": "proxy.example.com", json: true } as never,
      out,
    );
    const body = (client.accounts.update as Mock).mock.calls[0]?.[1] as { proxy: Record<string, unknown> };
    expect(body.proxy).not.toHaveProperty("password");
  });
});

// ---------------------------------------------------------------------------
// stdin secrets, off argv, CRLF trimmed
// ---------------------------------------------------------------------------

describe("account credentials — --password-stdin / --li-at-stdin", () => {
  it("--password-stdin resolves the piped secret and trims a trailing newline", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    const flags = { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", "password-stdin": true, json: true };
    await runAccountLink(client as never, flags as never, out, { readStdin: async () => "PWD_S\n" });
    expect(client.auth.intent).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { email: "a@b.c", password: "PWD_S" } }),
    );
    // The secret itself never lands anywhere in the parsed flags (the argv-equivalent) — only the trigger boolean does.
    expect(JSON.stringify(flags)).not.toContain("PWD_S");
  });

  it("--password-stdin trims a CRLF-terminated pipe (not just a bare trailing \\n)", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", "password-stdin": true, json: true } as never,
      out,
      { readStdin: async () => "PWD_S\r\n" },
    );
    const body = (client.auth.intent as Mock).mock.calls[0]?.[0] as { credentials: { password: string } };
    expect(body.credentials.password).toBe("PWD_S");
    expect(body.credentials.password).not.toContain("\r");
  });

  it("--li-at-stdin resolves the piped cookie", async () => {
    const { runAccountReconnect } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.accounts.reconnect as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountReconnect(
      client as never,
      { "account-id": "acc_1", "auth-method": "cookie", "user-agent": "UA", "li-at-stdin": true, json: true } as never,
      out,
      { readStdin: async () => "LIAT_S\n" },
    );
    expect(client.accounts.reconnect).toHaveBeenCalledWith("acc_1", expect.objectContaining({ cookie: { li_at: "LIAT_S" } }));
  });
});

// ---------------------------------------------------------------------------
// conflict matrix -> exit 2, no SDK call
// ---------------------------------------------------------------------------

describe("account credentials — conflict matrix (exit 2, zero SDK calls)", () => {
  const combos: Array<{ name: string; flags: Record<string, unknown> }> = [
    { name: "--password + --password-stdin", flags: { password: "x", "password-stdin": true, "auth-method": "credentials", email: "a@b.c" } },
    { name: "--li-at + --li-at-stdin", flags: { "li-at": "x", "li-at-stdin": true, "auth-method": "cookie" } },
    { name: "--password-stdin + --li-at-stdin", flags: { "password-stdin": true, "li-at-stdin": true, "auth-method": "credentials", email: "a@b.c" } },
    { name: "--li-at-stdin with --auth-method credentials", flags: { "li-at-stdin": true, "auth-method": "credentials", email: "a@b.c" } },
    { name: "--password-stdin with --auth-method cookie", flags: { "password-stdin": true, "auth-method": "cookie" } },
  ];

  for (const combo of combos) {
    it(`${combo.name} -> exit 2, auth.intent never called`, async () => {
      const { runAccountLink } = await import("../../src/commands/account.js");
      const client = makeClient();
      const out = makeOut();
      const exitSpy = mockExit();
      try {
        await expect(
          runAccountLink(client as never, { "seat-id": "seat_1", ...combo.flags } as never, out),
        ).rejects.toThrow("process.exit(2)");
      } finally {
        exitSpy.mockRestore();
      }
      expect(client.auth.intent).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// masked TTY prompt, non-TTY fail-fast, cookie has no prompt
// ---------------------------------------------------------------------------

describe("account credentials — masked TTY prompt + non-TTY fail-fast", () => {
  it("TTY: masked prompt resolves the password; stderr never echoes it", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", json: true } as never,
      out,
      { isTTY: true, readline: async () => "PROMPTED" },
    );
    expect(client.auth.intent).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { email: "a@b.c", password: "PROMPTED" } }),
    );
    const stderrOut = out.stderr.write.mock.calls.map((c) => c[0] as string).join("");
    expect(stderrOut).not.toContain("PROMPTED");
  });

  it("non-TTY, no --password-stdin: exit 2, message names password, never reads stdin (no hang)", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    const out = makeOut();
    const readStdin = vi.fn(async () => "SHOULD_NOT_READ");
    const exitSpy = mockExit();
    try {
      await expect(
        runAccountLink(
          client as never,
          { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", json: true } as never,
          out,
          { isTTY: false, readStdin },
        ),
      ).rejects.toThrow("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(client.auth.intent).not.toHaveBeenCalled();
    expect(readStdin).not.toHaveBeenCalled();
    const stderrOut = out.stderr.write.mock.calls.map((c) => c[0] as string).join("");
    expect(stderrOut).toContain("password");
  });

  it("cookie method, no li_at source: exit 2 on TTY too (no cookie prompt, by design)", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    const out = makeOut();
    const exitSpy = mockExit();
    try {
      await expect(
        runAccountLink(
          client as never,
          { "seat-id": "seat_1", "auth-method": "cookie", "user-agent": "UA", json: true } as never,
          out,
          { isTTY: true },
        ),
      ).rejects.toThrow("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    const stderrOut = out.stderr.write.mock.calls.map((c) => c[0] as string).join("");
    expect(stderrOut).toContain("li_at");
  });

  it("cookie method, no li_at source: exit 2 on non-TTY too", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    const out = makeOut();
    const exitSpy = mockExit();
    try {
      await expect(
        runAccountLink(
          client as never,
          { "seat-id": "seat_1", "auth-method": "cookie", "user-agent": "UA", json: true } as never,
          out,
          { isTTY: false },
        ),
      ).rejects.toThrow("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    const stderrOut = out.stderr.write.mock.calls.map((c) => c[0] as string).join("");
    expect(stderrOut).toContain("li_at");
  });
});

// ---------------------------------------------------------------------------
// --preview must never prompt / never fail-fast (qa amendment 7)
// ---------------------------------------------------------------------------

describe("account credentials — --preview skips prompt/fail-fast entirely", () => {
  it("--preview, credentials method, no password source, non-TTY: renders preview, does not exit", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    const out = makeOut();
    const exitSpy = mockExit();
    try {
      await runAccountLink(
        client as never,
        { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", preview: true } as never,
        out,
        { isTTY: false },
      );
    } finally {
      exitSpy.mockRestore();
    }
    expect(exitSpy).not.toHaveBeenCalled();
    expect(client.auth.intent).not.toHaveBeenCalled();
    const written = out.stdout.write.mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written) as { body: { credentials: Record<string, unknown> } };
    expect(parsed.body.credentials).toEqual({ email: "a@b.c" });
  });

  it("--preview, cookie method, no li_at source: renders preview, does not exit", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    const out = makeOut();
    const exitSpy = mockExit();
    try {
      await runAccountLink(
        client as never,
        { "seat-id": "seat_1", "auth-method": "cookie", preview: true } as never,
        out,
        { isTTY: false },
      );
    } finally {
      exitSpy.mockRestore();
    }
    expect(exitSpy).not.toHaveBeenCalled();
    expect(client.auth.intent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ps/shell-history warnings
// ---------------------------------------------------------------------------

describe("account credentials — ps/shell-history warnings on secret value flags", () => {
  type ArgDef = { description?: string };
  type SubCmd = { args?: Record<string, ArgDef> };

  async function loadArgs(command: string): Promise<Record<string, ArgDef>> {
    const { accountCommand } = await import("../../src/commands/account.js");
    const subCmds = (accountCommand as unknown as { subCommands: Record<string, SubCmd> }).subCommands;
    return subCmds[command]?.args ?? {};
  }

  it("link --help: --password/--li-at/--li-a/--proxy-password each warn and name their alternative; -stdin flags do not warn", async () => {
    const args = await loadArgs("link");
    expect(args["password"]?.description).toMatch(/ps|shell history/i);
    expect(args["password"]?.description).toContain("CURVIATE_LINKEDIN_PASSWORD");
    expect(args["li-at"]?.description).toMatch(/ps|shell history/i);
    expect(args["li-at"]?.description).toContain("CURVIATE_LINKEDIN_LI_AT");
    expect(args["li-a"]?.description).toMatch(/ps|shell history/i);
    expect(args["li-a"]?.description).toContain("CURVIATE_LINKEDIN_LI_A");
    expect(args["proxy-password"]?.description).toMatch(/ps|shell history/i);
    expect(args["proxy-password"]?.description).toContain("CURVIATE_PROXY_PASSWORD");

    expect(args["password-stdin"]?.description).not.toMatch(/ps|shell history/i);
    expect(args["li-at-stdin"]?.description).not.toMatch(/ps|shell history/i);
  });

  it("reconnect --help: same warnings present", async () => {
    const args = await loadArgs("reconnect");
    expect(args["password"]?.description).toMatch(/ps|shell history/i);
    expect(args["li-at"]?.description).toMatch(/ps|shell history/i);
    expect(args["li-a"]?.description).toMatch(/ps|shell history/i);
    expect(args["proxy-password"]?.description).toMatch(/ps|shell history/i);
    expect(args["password-stdin"]?.description).not.toMatch(/ps|shell history/i);
    expect(args["li-at-stdin"]?.description).not.toMatch(/ps|shell history/i);
  });

  it("update --help: only --proxy-password warns; update has no --password/--li-at flags at all", async () => {
    const args = await loadArgs("update");
    expect(args["proxy-password"]?.description).toMatch(/ps|shell history/i);
    expect(args["proxy-password"]?.description).toContain("CURVIATE_PROXY_PASSWORD");
    expect(args).not.toHaveProperty("password");
    expect(args).not.toHaveProperty("li-at");
  });
});

// ---------------------------------------------------------------------------
// sentinel never leaks; --preview masks per-secret; masking
// runs on a copy (a later non-preview call still sends the real secret).
// ---------------------------------------------------------------------------

describe("account credentials — sentinel never leaks to stdout/stderr", () => {
  const SENTINEL = "LI_SENTINEL_MUST_NOT_LEAK";

  it("flag-sourced password sentinel never appears in captured output (success path)", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account", account_id: "acc_1" });
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", password: SENTINEL, json: true } as never,
      out,
    );
    const combined =
      out.stdout.write.mock.calls.map((c) => c[0] as string).join("") +
      out.stderr.write.mock.calls.map((c) => c[0] as string).join("");
    expect(combined).not.toContain(SENTINEL);
    expect(client.auth.intent).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.objectContaining({ password: SENTINEL }) }),
    );
  });

  it("stdin-sourced sentinel never appears in output", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account" });
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", "password-stdin": true, json: true } as never,
      out,
      { readStdin: async () => SENTINEL },
    );
    const combined =
      out.stdout.write.mock.calls.map((c) => c[0] as string).join("") +
      out.stderr.write.mock.calls.map((c) => c[0] as string).join("");
    expect(combined).not.toContain(SENTINEL);
  });

  it("env-sourced sentinel never appears in output", async () => {
    process.env[ENV_PASSWORD] = SENTINEL;
    try {
      const { runAccountLink } = await import("../../src/commands/account.js");
      const client = makeClient();
      (client.auth.intent as Mock).mockResolvedValue({ object: "account" });
      const out = makeOut();
      await runAccountLink(
        client as never,
        { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", json: true } as never,
        out,
      );
      const combined =
        out.stdout.write.mock.calls.map((c) => c[0] as string).join("") +
        out.stderr.write.mock.calls.map((c) => c[0] as string).join("");
      expect(combined).not.toContain(SENTINEL);
    } finally {
      delete process.env[ENV_PASSWORD];
    }
  });

  it("--preview masks the credentials.password sentinel", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    const out = makeOut();
    await runAccountLink(
      client as never,
      { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", password: SENTINEL, preview: true } as never,
      out,
    );
    const written = out.stdout.write.mock.calls.map((c) => c[0] as string).join("");
    expect(written).not.toContain(SENTINEL);
    expect(written).toContain("••••");
  });

  it("--preview masks the cookie.li_at and cookie.li_a sentinels (reconnect)", async () => {
    const { runAccountReconnect } = await import("../../src/commands/account.js");
    const client = makeClient();
    const out = makeOut();
    await runAccountReconnect(
      client as never,
      { "account-id": "acc_1", "auth-method": "cookie", "li-at": SENTINEL, "li-a": `${SENTINEL}_A`, preview: true } as never,
      out,
    );
    const written = out.stdout.write.mock.calls.map((c) => c[0] as string).join("");
    expect(written).not.toContain(SENTINEL);
    expect(written).toContain("••••");
  });

  it("--preview masks the proxy.password sentinel (update)", async () => {
    const { runAccountUpdate } = await import("../../src/commands/account.js");
    const client = makeClient();
    const out = makeOut();
    await runAccountUpdate(
      client as never,
      { "account-id": "acc_1", "proxy-host": "proxy.example.com", "proxy-password": SENTINEL, preview: true } as never,
      out,
    );
    const written = out.stdout.write.mock.calls.map((c) => c[0] as string).join("");
    expect(written).not.toContain(SENTINEL);
    expect(written).toContain("••••");
  });

  it("masking runs on a copy: a later non-preview call with the same flags still sends the real secret", async () => {
    const { runAccountLink } = await import("../../src/commands/account.js");
    const client = makeClient();
    (client.auth.intent as Mock).mockResolvedValue({ object: "account" });
    const flags = { "seat-id": "seat_1", "auth-method": "credentials", email: "a@b.c", password: SENTINEL, json: true };

    await runAccountLink(client as never, { ...flags, preview: true } as never, makeOut());
    const realOut = makeOut();
    await runAccountLink(client as never, flags as never, realOut);

    expect(client.auth.intent).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { email: "a@b.c", password: SENTINEL } }),
    );
  });
});
