/**
 * `curviate account` — account connection management (root-scoped).
 *
 * Subcommands:
 *   account list                                      — list connected accounts
 *   account get <account_id>                          — get one account
 *   account link <body…>                              — link a new account (write)
 *   account connect-link <body…>                      — generate a hosted connect URL, then (TTY+interactive) open + wait (write)
 *   account connect-session poll --session <id>       — poll a hosted connect-link session for completion (write)
 *   account reconnect <account_id> <body…>            — re-authorize a disconnected account (write)
 *   account refresh <account_id>                      — refresh account sources (write)
 *   account update <account_id> <body…>               — update proxy config (write)
 *   account disconnect <account_id>                   — hard-disconnect an account (write)
 *   account checkpoint submit <body…>                 — submit OTP/2FA code (body-addressed, write)
 *   account checkpoint poll <body…>                   — poll mobile-app approval (body-addressed, write)
 *   account checkpoint resend <body…>                 — resend challenge notification (body-addressed, write)
 *
 * Root-scoped: all methods live on `curviate.accounts.*` (NOT account-scoped).
 * account_id positionals pass verbatim (NOT resolveIdentifier — not a member/company id).
 * Checkpoint ops are body-addressed: the checkpoint id goes in the body as `account_id`
 * (the provisional account from the 202 response), passed via --checkpoint flag.
 *
 * connect-link / connect-session poll: `accounts.getConnectSession` — like
 * `accounts.resendCheckpoint` — is targeted through the duck-typed
 * MinimalClient interface below rather than the SDK's own generated types.
 * Both are real methods on the published SDK (0.11.0+) and both are covered
 * in the SDK-parity manifest (test/parity.test.ts); the duck-typing is a
 * standing decoupling choice (see MinimalClient), not a placeholder for a
 * method the SDK hasn't shipped yet.
 *
 * Slim projection (default): account list and account get return a
 * compact field subset — six cached account-enrichment fields (username,
 * premium_id, public_identifier, substrate_created_at, signatures, groups)
 * are verbose-only. Pass --verbose for the full SDK response. account get
 * keeps --fields but suppresses --limit/--cursor/--all/--max-pages (a
 * single-object read) — account list is unaffected (a genuine list read,
 * keeps all pagination flags).
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS, READ_SINGLE_FLAGS, WRITE_SINGLE_FLAGS } from "../lib/global-flags.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { buildPreviewOutput } from "../lib/preview.js";
import { streamAll } from "../lib/paginate.js";
import { slimAccountList, slimAccountListItem, slimAccountGet } from "../lib/slim.js";
import { readlineSync } from "../lib/readline.js";
import { defaultReadStdin } from "../lib/stdin.js";
import {
  resolveSecret,
  checkCredentialConflicts,
  maskCredentialSecretsForPreview,
} from "../lib/credential-resolve.js";
import { AUTH_NEEDED } from "../lib/exit-codes.js";
import {
  printChallengeCopy,
  printResendHintIfApplicable,
  type ChallengeType,
} from "../lib/checkpoint-copy.js";
import {
  CHECKPOINT_POLL_FIRST_DELAY_MS,
  nextCheckpointPollDelayMs,
} from "../lib/checkpoint-cadence.js";
import type { CurviateError } from "@curviate/sdk";

// ps/shell-history warning template (mirrors the --api-key warning in global-flags.ts).
const PW_WARNING = (stdinFlag: string, envVar: string) =>
  `Note: a value on the command line is visible to other processes via \`ps\` and saved in shell history; prefer \`${stdinFlag}\` or the ${envVar} env var.`;
const OPTIONAL_SECRET_WARNING = (envVar: string) =>
  `Note: a value on the command line is visible to other processes via \`ps\` and saved in shell history; prefer the ${envVar} env var.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AccountFlags = {
  // positional / path
  "account-id"?: string;
  // link / reconnect body fields
  "seat-id"?: string;
  "auth-method"?: string;
  email?: string;
  password?: string;
  "password-stdin"?: boolean;
  "li-at"?: string;
  "li-at-stdin"?: boolean;
  "li-a"?: string;
  "no-interactive"?: boolean;
  country?: string;
  ip?: string;
  "proxy-protocol"?: string;
  "proxy-host"?: string;
  "proxy-port"?: string;
  "proxy-username"?: string;
  "proxy-password"?: string;
  "user-agent"?: string;
  "recruiter-contract-id"?: string;
  // connect-link body fields
  purpose?: string;
  "expires-in-seconds"?: string;
  "redirect-url"?: string;
  // connect-link / connect-session poll open+wait UX
  open?: boolean;        // connect-link: auto-open the URL (TTY+interactive default: on)
  session?: string;      // connect-session poll: the session_id to poll
  // checkpoint body fields
  checkpoint?: string;   // maps to body account_id
  code?: string;
  wait?: boolean;        // checkpoint poll / connect-link / connect-session poll --wait: adaptive-cadence loop instead of a single poll
  // global
  json?: boolean;
  fields?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  "max-pages"?: string;
  preview?: boolean;
  verbose?: boolean;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
};

type OutputStreams = {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
};

// Minimal root-level client shape (accounts namespace is root-scoped).
//
// `getConnectSession` and `resendCheckpoint` are both duck-typed against this
// interface rather than the SDK's own generated types, even though both are
// real published SDK methods (0.11.0+). This is why the CLI package
// deliberately excludes itself from the root workspace — it decouples from
// SDK-internal types on purpose, so the CLI can ship ahead of an SDK regen
// when it needs to.
type MinimalClient = {
  accounts: {
    list: (params?: Record<string, unknown>) => Promise<unknown>;
    get: (accountId: string) => Promise<unknown>;
    link: (body: Record<string, unknown>) => Promise<unknown>;
    createConnectLink: (body: Record<string, unknown>) => Promise<unknown>;
    reconnect: (accountId: string, body: Record<string, unknown>) => Promise<unknown>;
    refresh: (accountId: string) => Promise<unknown>;
    update: (accountId: string, body: Record<string, unknown>) => Promise<unknown>;
    disconnect: (accountId: string) => Promise<unknown>;
    submitCheckpoint: (body: Record<string, unknown>) => Promise<unknown>;
    pollCheckpoint: (body: Record<string, unknown>) => Promise<unknown>;
    resendCheckpoint: (body: Record<string, unknown>) => Promise<unknown>;
    getConnectSession: (params: Record<string, unknown>) => Promise<unknown>;
  };
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function rejectPreviewOnRead(preview: boolean | undefined, out: OutputStreams): void {
  if (preview) {
    out.stderr.write("error: --preview is only valid on write commands (mutations). Reads just run.\n");
    process.exit(2);
  }
}

function rejectAllOnNonPaginated(all: boolean | undefined, out: OutputStreams): void {
  if (all) {
    out.stderr.write("error: --all is not supported on non-paginated commands.\n");
    process.exit(2);
  }
}

function buildOutputStreams(): OutputStreams {
  return {
    stdout: { write: (s: string) => process.stdout.write(s) },
    stderr: { write: (s: string) => process.stderr.write(s) },
  };
}

function resolveOutputOpts(flags: AccountFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
    verbose: flags.verbose ?? false,
  };
}

async function handleError(err: unknown, outOpts: ReturnType<typeof resolveOutputOpts>, out: OutputStreams): Promise<never> {
  const { CurviateError } = await import("@curviate/sdk");
  if (err instanceof CurviateError) {
    const { getExitCode } = await import("../lib/exit-codes.js");
    renderError(err as CurviateError, outOpts, out);
    process.exit(getExitCode(err.code));
  }
  renderUnexpectedError(err, out);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Exported run functions (testable without citty)
// ---------------------------------------------------------------------------

/** Run `account list [--all] [--limit] [--cursor]`. */
export async function runAccountList(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);

  const outOpts = resolveOutputOpts(flags);
  const all = flags.all ?? false;
  const maxPages = flags["max-pages"] ? parseInt(flags["max-pages"], 10) : 100;
  const limit = flags.limit ? parseInt(flags.limit, 10) : undefined;
  const cursor = flags.cursor;

  const params: Record<string, unknown> = {};
  if (limit !== undefined) params["limit"] = limit;
  if (cursor) params["cursor"] = cursor;

  try {
    if (all) {
      const fn = (p: Record<string, unknown>) =>
        client.accounts.list(p) as Promise<{ items?: unknown[]; cursor?: string | null }>;
      for await (const item of streamAll(fn, params, {
        maxPages,
        onTruncated: (n) => out.stderr.write(`Streaming truncated at ${n} page(s). Use --all --max-pages or --cursor for manual paging.\n`),
      })) {
        // Slim mode (default) projects each NDJSON item too; --verbose emits raw items.
        const projected = outOpts.verbose ? item : slimAccountListItem(item as Record<string, unknown>);
        out.stdout.write(JSON.stringify(projected) + "\n");
      }
    } else {
      const result = await client.accounts.list(params);
      renderSuccess(result, { ...outOpts, slim: slimAccountList }, out);
    }
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/** Run `account get <account_id>`. account_id passes verbatim. */
export async function runAccountGet(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  rejectPreviewOnRead(flags.preview, out);
  rejectAllOnNonPaginated(flags.all, out);

  const accountId = flags["account-id"] ?? "";
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await client.accounts.get(accountId);
    renderSuccess(result, { ...outOpts, slim: slimAccountGet }, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Injectable seams for LinkedIn-credential resolution (masked prompt +
 * non-TTY fail-fast) and for the guided checkpoint follow-through loop. All
 * optional — real defaults (the actual TTY state, the real masked readline,
 * the real stdin reader, the real clock/timer) are substituted when
 * omitted, so existing call sites need not pass this at all.
 */
export interface CredentialIO {
  /** stdin.isTTY — injectable for tests. Defaults to the real process.stdin.isTTY. */
  isTTY?: boolean;
  /**
   * stdout.isTTY — injectable for tests. Defaults to the real
   * process.stdout.isTTY. Combined with `isTTY` to decide the guided
   * checkpoint loop's interactive/non-interactive branch — either stream
   * being non-TTY forces the non-interactive path.
   */
  isOutputTTY?: boolean;
  /**
   * Injectable prompt function. Defaults to lib/readline.ts's readlineSync.
   * Used masked ({mask:true}) for the credentials password prompt, and
   * unmasked (no opts) for the checkpoint-code prompt — a checkpoint code
   * is not persisted secret material, but it must never reach argv.
   */
  readline?: (prompt: string, opts?: { mask?: boolean }) => Promise<string>;
  /** Injectable stdin reader for --password-stdin/--li-at-stdin. Defaults to lib/stdin.ts's defaultReadStdin. */
  readStdin?: () => Promise<string>;
  /** Injectable sleep for the interactive mobile-app-approval poll sub-loop. Defaults to a real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for the poll sub-loop's elapsed-time/timeout arithmetic. Defaults to Date.now. */
  now?: () => number;
  /**
   * Injectable browser opener for `account connect-link`'s auto-open.
   * Defaults to the real `open` package (dynamically imported so it is never
   * loaded — and never spawns a real browser — unless this default path is
   * actually reached). Tests inject a stub here instead of mocking the ESM
   * package directly.
   */
  open?: (url: string) => Promise<unknown>;
}

/**
 * Build the auth body for link/reconnect. Resolves the LinkedIn-account
 * secrets (password, li_at, li_a, proxy password) through the flag > stdin >
 * env > prompt > fail-fast tiers before assembling the body — the secret
 * reaches only this returned object, never a log or preview render.
 *
 * Under `--preview` (ctx.previewMode), interactive fallbacks (prompt,
 * fail-fast) are skipped entirely — a client-side render must never prompt
 * or exit — so a missing required secret simply resolves to `undefined` and
 * is omitted from the body.
 */
async function buildAuthBody(
  flags: AccountFlags,
  ctx: { out: OutputStreams; isTTY: boolean; readline: (prompt: string, opts?: { mask?: boolean }) => Promise<string>; readStdin: () => Promise<string>; previewMode: boolean },
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};

  if (flags["auth-method"]) body["auth_method"] = flags["auth-method"];
  if (flags["user-agent"]) body["user_agent"] = flags["user-agent"];
  if (flags["recruiter-contract-id"]) body["recruiter_contract_id"] = flags["recruiter-contract-id"];

  // credentials object (auth-method === "credentials")
  if (flags["auth-method"] === "credentials") {
    const password = await resolveSecret({
      flagValue: flags.password,
      stdinRequested: flags["password-stdin"],
      envVar: "CURVIATE_LINKEDIN_PASSWORD",
      readStdin: ctx.readStdin,
      required: true,
      // The interactive prompt/fail-fast only engages once --email is present
      // (nothing meaningful to prompt toward yet otherwise) — and never
      // under --preview (a client-side render must not prompt or exit).
      allowInteractive: !ctx.previewMode && Boolean(flags.email),
      failMessage: "no password — pass --password, --password-stdin, or set CURVIATE_LINKEDIN_PASSWORD",
      prompt: { isTTY: ctx.isTTY, readline: ctx.readline, promptText: "LinkedIn password: " },
      out: ctx.out,
    });

    if (flags.email || password !== undefined) {
      body["credentials"] = {
        ...(flags.email ? { email: flags.email } : {}),
        ...(password !== undefined ? { password } : {}),
      };
    }
  }

  // cookie object (auth-method === "cookie") — no interactive prompt, by design.
  if (flags["auth-method"] === "cookie") {
    const liAt = await resolveSecret({
      flagValue: flags["li-at"],
      stdinRequested: flags["li-at-stdin"],
      envVar: "CURVIATE_LINKEDIN_LI_AT",
      readStdin: ctx.readStdin,
      required: true,
      allowInteractive: !ctx.previewMode,
      failMessage: "no li_at — pass --li-at, --li-at-stdin, or set CURVIATE_LINKEDIN_LI_AT",
      out: ctx.out,
    });
    const liA = await resolveSecret({
      flagValue: flags["li-a"],
      envVar: "CURVIATE_LINKEDIN_LI_A",
      out: ctx.out,
    });

    if (liAt !== undefined || liA !== undefined) {
      body["cookie"] = {
        ...(liAt !== undefined ? { li_at: liAt } : {}),
        ...(liA !== undefined ? { li_a: liA } : {}),
      };
    }
  }

  // location hints
  if (flags.country) body["country"] = flags.country;
  if (flags.ip) body["ip"] = flags.ip;

  // proxy (optional secret: flag > env > omitted, no prompt, no fail-fast)
  if (flags["proxy-host"]) {
    const proxyPassword = await resolveSecret({
      flagValue: flags["proxy-password"],
      envVar: "CURVIATE_PROXY_PASSWORD",
      out: ctx.out,
    });
    body["proxy"] = {
      protocol: flags["proxy-protocol"] ?? "http",
      host: flags["proxy-host"],
      port: flags["proxy-port"] ? parseInt(flags["proxy-port"], 10) : 80,
      ...(flags["proxy-username"] ? { username: flags["proxy-username"] } : {}),
      ...(proxyPassword !== undefined ? { password: proxyPassword } : {}),
    };
  }

  return body;
}

/**
 * The real browser opener, dynamically imported so the `open` package (and
 * any browser it might spawn) is only ever touched on this exact code path —
 * never during a test, which always injects its own `open` stub instead.
 */
async function defaultOpen(url: string): Promise<unknown> {
  const open = (await import("open")).default;
  return open(url);
}

function resolveCredentialIO(io: CredentialIO): {
  isTTY: boolean;
  isOutputTTY: boolean;
  readline: (prompt: string, opts?: { mask?: boolean }) => Promise<string>;
  readStdin: () => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  open: (url: string) => Promise<unknown>;
} {
  return {
    isTTY: io.isTTY ?? (process.stdin.isTTY ?? false),
    isOutputTTY: io.isOutputTTY ?? (process.stdout.isTTY ?? false),
    readline: io.readline ?? readlineSync,
    readStdin: io.readStdin ?? defaultReadStdin,
    sleep: io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    now: io.now ?? (() => Date.now()),
    open: io.open ?? defaultOpen,
  };
}

// ---------------------------------------------------------------------------
// Guided checkpoint follow-through (link/reconnect 202 → resolve in-process)
// ---------------------------------------------------------------------------

/** The 202 checkpoint-required envelope (also the shape of a chained submit response). */
interface CheckpointEnvelope {
  object?: string;
  status?: string;
  account_id?: string;
  challenge_type?: string;
  expires_at?: string;
}

type ResolvedCredentialIO = ReturnType<typeof resolveCredentialIO>;

function printConnected(
  result: unknown,
  ctx: { out: OutputStreams; outOpts: ReturnType<typeof resolveOutputOpts>; successVerb: "linked" | "reconnected" },
): void {
  const r = result as { account_id?: string };
  ctx.out.stderr.write(`Account ${ctx.successVerb}: ${r.account_id ?? ""}\n`);
  renderSuccess(result, ctx.outOpts, ctx.out);
}

/** The wire body of a CHECKPOINT_INVALID_CODE error carries an extra (untyped-by-the-SDK) attempts_remaining field. */
function printInvalidCodeRetryHint(err: unknown, out: OutputStreams): void {
  const attemptsRemaining = (err as { attempts_remaining?: unknown }).attempts_remaining;
  const message =
    typeof attemptsRemaining === "number"
      ? `That code was not accepted — ${attemptsRemaining} attempt(s) remaining.`
      : "That code was not accepted — please try again.";
  out.stderr.write(`${message}\n`);
}

type MobileApprovalOutcome =
  | { kind: "active"; result: unknown }
  | { kind: "terminal_failure"; status: "expired" | "failed" }
  | { kind: "timeout" };

/**
 * Wait for mobile-app-approval by polling on the same adaptive cadence as
 * the checkpoint poll wait loop, bounded by the checkpoint's expiry (or a
 * 10-minute default when the response carries no expiry hint).
 */
async function waitForMobileApproval(
  client: MinimalClient,
  accountId: string,
  expiresAt: string | undefined,
  ctx: {
    out: OutputStreams;
    outOpts: ReturnType<typeof resolveOutputOpts>;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
  },
): Promise<MobileApprovalOutcome> {
  const startedAt = ctx.now();
  const timeoutAt = expiresAt ? new Date(expiresAt).getTime() : startedAt + 10 * 60_000;

  await ctx.sleep(CHECKPOINT_POLL_FIRST_DELAY_MS);

  for (;;) {
    let result: unknown;
    try {
      result = await client.accounts.pollCheckpoint({ account_id: accountId });
    } catch (err) {
      return await handleError(err, ctx.outOpts, ctx.out);
    }
    const status = (result as { status?: string }).status;
    if (status === "active") return { kind: "active", result };
    if (status === "expired" || status === "failed") {
      return { kind: "terminal_failure", status };
    }
    const n = ctx.now();
    if (n >= timeoutAt) return { kind: "timeout" };
    await ctx.sleep(nextCheckpointPollDelayMs(n - startedAt));
  }
}

/**
 * Resolve a 202 checkpoint_required response in-process: print the
 * challenge copy and the resend hint, then either read/submit a code
 * (looping through 422 retries and chained challenges) or wait out a
 * codeless mobile-app-approval challenge.
 */
async function runInteractiveCheckpointLoop(
  client: MinimalClient,
  initial: CheckpointEnvelope,
  ctx: {
    out: OutputStreams;
    outOpts: ReturnType<typeof resolveOutputOpts>;
    readline: (prompt: string, opts?: { mask?: boolean }) => Promise<string>;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    successVerb: "linked" | "reconnected";
  },
): Promise<void> {
  const { CurviateError } = await import("@curviate/sdk");
  let current: CheckpointEnvelope = initial;

  for (;;) {
    const challengeType = current.challenge_type as ChallengeType;
    const accountId = current.account_id ?? "";

    printChallengeCopy(challengeType, ctx.out);
    printResendHintIfApplicable(challengeType, accountId, ctx.out);

    if (challengeType === "mobile_app_approval") {
      const outcome = await waitForMobileApproval(client, accountId, current.expires_at, {
        out: ctx.out,
        outOpts: ctx.outOpts,
        sleep: ctx.sleep,
        now: ctx.now,
      });
      if (outcome.kind === "active") {
        printConnected(outcome.result, { out: ctx.out, outOpts: ctx.outOpts, successVerb: ctx.successVerb });
        return;
      }
      if (outcome.kind === "terminal_failure") {
        ctx.out.stderr.write(
          `This checkpoint has ${outcome.status}. Run the connect command again to restart.\n`,
        );
        process.exit(9);
        return;
      }
      // outcome.kind === "timeout"
      ctx.out.stderr.write(
        `Still waiting for approval. Finish out-of-band: curviate account checkpoint poll --checkpoint ${accountId}\n`,
      );
      process.exit(AUTH_NEEDED);
      return;
    }

    // Code-based challenge: inner retry loop (422 re-prompts without
    // re-printing the challenge copy; a chained 202 breaks out to the
    // outer loop, which prints the new stage's copy).
    for (;;) {
      const code = await ctx.readline("Enter the code: ");
      try {
        const result = await client.accounts.submitCheckpoint({ account_id: accountId, code });
        const r = result as CheckpointEnvelope;
        if (r.status === "checkpoint_required") {
          current = { ...r, account_id: r.account_id ?? accountId };
          break;
        }
        printConnected(result, { out: ctx.out, outOpts: ctx.outOpts, successVerb: ctx.successVerb });
        return;
      } catch (err) {
        if (err instanceof CurviateError && err.code === "CHECKPOINT_INVALID_CODE") {
          printInvalidCodeRetryHint(err, ctx.out);
          continue;
        }
        await handleError(err, ctx.outOpts, ctx.out);
      }
    }
  }
}

/**
 * Branch a link/reconnect response on the 202 checkpoint_required
 * discriminator: a completed (200/201) result renders as before; a
 * checkpoint resolves in-process on an interactive TTY session, or renders
 * the envelope and exits AUTH_NEEDED (12) otherwise.
 */
async function handleAccountConnectResult(
  client: MinimalClient,
  result: unknown,
  ctx: {
    out: OutputStreams;
    flags: AccountFlags;
    outOpts: ReturnType<typeof resolveOutputOpts>;
    io: ResolvedCredentialIO;
    successVerb: "linked" | "reconnected";
  },
): Promise<void> {
  const envelope = result as CheckpointEnvelope;

  if (envelope.status !== "checkpoint_required") {
    renderSuccess(result, ctx.outOpts, ctx.out);
    return;
  }

  const isInteractive = ctx.io.isTTY && ctx.io.isOutputTTY && !(ctx.flags["no-interactive"] ?? false);

  if (!isInteractive) {
    renderSuccess(result, ctx.outOpts, ctx.out);
    process.exit(AUTH_NEEDED);
    return;
  }

  await runInteractiveCheckpointLoop(client, envelope, {
    out: ctx.out,
    outOpts: ctx.outOpts,
    readline: ctx.io.readline,
    sleep: ctx.io.sleep,
    now: ctx.io.now,
    successVerb: ctx.successVerb,
  });
}

/**
 * Run `account link <body…>`.
 * Required: --seat-id, --auth-method.
 */
export async function runAccountLink(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
  io: CredentialIO = {},
): Promise<void> {
  // Validate required fields
  if (!flags["seat-id"]) {
    out.stderr.write("error: --seat-id is required for account link.\n");
    process.exit(2);
  }
  if (!flags["auth-method"]) {
    out.stderr.write("error: --auth-method is required for account link (credentials | cookie).\n");
    process.exit(2);
  }

  checkCredentialConflicts(flags, out);

  const resolvedIo = resolveCredentialIO(io);
  const authBody = await buildAuthBody(flags, {
    out,
    isTTY: resolvedIo.isTTY,
    readline: resolvedIo.readline,
    readStdin: resolvedIo.readStdin,
    previewMode: flags.preview ?? false,
  });

  const body: Record<string, unknown> = {
    seat_id: flags["seat-id"],
    ...authBody,
  };

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({ method: "accounts.link", args: {}, body: maskCredentialSecretsForPreview(body) });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  let result: unknown;
  try {
    result = await client.accounts.link(body);
  } catch (err) {
    await handleError(err, outOpts, out);
    return;
  }

  await handleAccountConnectResult(client, result, {
    out,
    flags,
    outOpts,
    io: resolvedIo,
    successVerb: "linked",
  });
}

/** A connect session's poll response — `account_id` is null until `resolved`. */
interface ConnectSessionEnvelope {
  object?: string;
  session_id?: string;
  status?: string;
  account_id?: string | null;
  expires_at?: string;
}

/** Terminal outcome of the connect-session adaptive-cadence wait loop. */
type ConnectSessionWaitOutcome =
  | { kind: "resolved"; result: unknown }
  | { kind: "terminal_failure"; status: "expired" | "failed"; result: unknown }
  | { kind: "timeout"; result: unknown };

/**
 * The connect-session `--wait` adaptive-cadence loop — structurally the same
 * loop as the checkpoint poll wait loop above (same cadence constants, same
 * lazily-derived timeout bound off the first response's `expires_at`), driven
 * against `accounts.getConnectSession` instead of `accounts.pollCheckpoint`.
 * Shared by `connect-link`'s post-open wait and the standalone
 * `connect-session poll --wait` command — one loop, two callers.
 */
async function runConnectSessionWaitLoop(
  client: MinimalClient,
  params: Record<string, unknown>,
  ctx: {
    out: OutputStreams;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    showTicker: boolean;
    timeoutOverrideMs?: number;
  },
): Promise<ConnectSessionWaitOutcome> {
  const startedAt = ctx.now();
  let timeoutAt: number | undefined =
    ctx.timeoutOverrideMs !== undefined ? startedAt + ctx.timeoutOverrideMs : undefined;

  await ctx.sleep(CHECKPOINT_POLL_FIRST_DELAY_MS);

  for (;;) {
    const result = await client.accounts.getConnectSession(params);
    const r = result as ConnectSessionEnvelope;

    if (r.status === "resolved") return { kind: "resolved", result };
    if (r.status === "expired" || r.status === "failed") {
      return { kind: "terminal_failure", status: r.status, result };
    }

    if (timeoutAt === undefined) {
      const expiresAtMs = r.expires_at ? new Date(r.expires_at).getTime() : NaN;
      timeoutAt = Number.isNaN(expiresAtMs) ? startedAt + 10 * 60_000 : expiresAtMs;
    }

    const n = ctx.now();
    if (n >= timeoutAt) return { kind: "timeout", result };

    if (ctx.showTicker) {
      ctx.out.stderr.write(`\rWaiting for the account to connect… ${formatRemaining(timeoutAt - n)} remaining`);
    }

    await ctx.sleep(nextCheckpointPollDelayMs(n - startedAt));
  }
}

function printConnectSessionResolved(
  result: unknown,
  ctx: { out: OutputStreams; outOpts: ReturnType<typeof resolveOutputOpts> },
): void {
  const r = result as ConnectSessionEnvelope;
  ctx.out.stderr.write(`Account connected: ${r.account_id ?? ""}\n`);
  renderSuccess(result, ctx.outOpts, ctx.out);
}

/** Parse `--timeout <ms>` (the wait-loop bound, not the SDK request timeout). Exits 2 on a non-numeric value. */
function resolveWaitTimeoutOverrideMs(flags: AccountFlags, out: OutputStreams): number | undefined {
  if (flags.timeout === undefined) return undefined;
  const parsed = Number(flags.timeout);
  if (Number.isNaN(parsed)) {
    out.stderr.write("error: --timeout must be a number of milliseconds.\n");
    process.exit(2);
  }
  return parsed;
}

/**
 * Run `account connect-link <body…> [--wait/--no-wait] [--open/--no-open] [--timeout <ms>]`.
 * All body fields are optional (conditional on purpose).
 *
 * TTY + interactive (default): auto-opens the returned URL in the browser,
 * then waits on the adaptive cadence for the session to resolve — printing a
 * refreshing status line while pending (unless --json), then a terminal exit
 * (0 resolved, 9 expired/failed, 12 AUTH_NEEDED on a wait-window timeout).
 *
 * Non-TTY / --no-interactive (the agent path): NEVER opens a browser and
 * NEVER waits — prints the URL, a relay instruction, and the session_id, then
 * returns immediately (exit 0). A headless caller must not block on a
 * hand-off that requires a human; poll later with `connect-session poll`.
 */
export async function runAccountConnectLink(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
  io: CredentialIO = {},
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (flags["seat-id"]) body["seat_id"] = flags["seat-id"];
  if (flags["account-id"]) body["account_id"] = flags["account-id"];
  if (flags.purpose) body["purpose"] = flags.purpose;
  if (flags["expires-in-seconds"]) body["expires_in_seconds"] = parseInt(flags["expires-in-seconds"], 10);
  if (flags["redirect-url"]) body["redirect_url"] = flags["redirect-url"];

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({ method: "accounts.createConnectLink", args: {}, body });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  let result: unknown;
  try {
    result = await client.accounts.createConnectLink(body);
  } catch (err) {
    await handleError(err, outOpts, out);
    return;
  }

  const mint = result as { url?: string; session_id?: string };
  const resolvedIo = resolveCredentialIO(io);
  const isInteractive = resolvedIo.isTTY && resolvedIo.isOutputTTY && !(flags["no-interactive"] ?? false);

  if (!isInteractive) {
    if (mint.url) {
      out.stderr.write(`Open this URL in a browser to connect the account: ${mint.url}\n`);
    }
    if (mint.session_id) {
      out.stderr.write(
        `Session: ${mint.session_id} — check it later with: curviate account connect-session poll --session ${mint.session_id} --wait\n`,
      );
    }
    renderSuccess(result, outOpts, out);
    return;
  }

  if ((flags.open ?? true) && mint.url) {
    await resolvedIo.open(mint.url);
  }

  if (!(flags.wait ?? true)) {
    renderSuccess(result, outOpts, out);
    return;
  }

  const timeoutOverrideMs = resolveWaitTimeoutOverrideMs(flags, out);
  const showTicker = resolvedIo.isOutputTTY && !(flags.json ?? false);
  const params: Record<string, unknown> = { session_id: mint.session_id };

  let outcome: ConnectSessionWaitOutcome;
  try {
    outcome = await runConnectSessionWaitLoop(client, params, {
      out,
      sleep: resolvedIo.sleep,
      now: resolvedIo.now,
      showTicker,
      timeoutOverrideMs,
    });
  } catch (err) {
    await handleError(err, outOpts, out);
    return;
  }

  if (outcome.kind === "resolved") {
    printConnectSessionResolved(outcome.result, { out, outOpts });
    return;
  }
  if (outcome.kind === "terminal_failure") {
    renderSuccess(outcome.result, outOpts, out);
    out.stderr.write(
      `This connect session has ${outcome.status}. Generate a new link: curviate account connect-link.\n`,
    );
    process.exit(9);
    return;
  }
  // outcome.kind === "timeout"
  renderSuccess(outcome.result, outOpts, out);
  out.stderr.write(
    `Still waiting for the account to connect — the wait window elapsed. Check again: curviate account connect-session poll --session ${mint.session_id} --wait\n`,
  );
  process.exit(AUTH_NEEDED);
}

/**
 * Run `account connect-session poll --session <session_id> [--wait] [--timeout <ms>]`.
 *
 * Without `--wait` (default): a single poll, prints the body, exits 0
 * regardless of status — the JSON `status` field is for the caller to branch
 * on, not an error signal.
 * With `--wait`: the same adaptive-cadence loop and terminal exit codes as
 * `connect-link`'s own wait (0 resolved, 9 expired/failed, 12 AUTH_NEEDED on
 * a wait-window timeout) — the standalone counterpart for an agent that
 * minted the link with `--no-wait`/non-interactively and is now checking on
 * a session_id it already has.
 */
export async function runAccountConnectSessionPoll(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
  io: CredentialIO = {},
): Promise<void> {
  if (!flags.session) {
    out.stderr.write("error: --session is required (the session_id from `account connect-link`).\n");
    process.exit(2);
  }

  const params: Record<string, unknown> = { session_id: flags.session };
  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({ method: "accounts.getConnectSession", args: {}, body: params });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  if (!flags.wait) {
    try {
      const result = await client.accounts.getConnectSession(params);
      renderSuccess(result, outOpts, out);
    } catch (err) {
      await handleError(err, outOpts, out);
    }
    return;
  }

  const timeoutOverrideMs = resolveWaitTimeoutOverrideMs(flags, out);
  const resolvedIo = resolveCredentialIO(io);
  const showTicker = resolvedIo.isOutputTTY && !(flags.json ?? false);

  let outcome: ConnectSessionWaitOutcome;
  try {
    outcome = await runConnectSessionWaitLoop(client, params, {
      out,
      sleep: resolvedIo.sleep,
      now: resolvedIo.now,
      showTicker,
      timeoutOverrideMs,
    });
  } catch (err) {
    await handleError(err, outOpts, out);
    return;
  }

  if (outcome.kind === "resolved") {
    printConnectSessionResolved(outcome.result, { out, outOpts });
    return;
  }
  if (outcome.kind === "terminal_failure") {
    renderSuccess(outcome.result, outOpts, out);
    out.stderr.write(
      `This connect session has ${outcome.status}. Generate a new link: curviate account connect-link.\n`,
    );
    process.exit(9);
    return;
  }
  // outcome.kind === "timeout"
  renderSuccess(outcome.result, outOpts, out);
  out.stderr.write(
    `Still waiting for the account to connect — the wait window elapsed. Check again: curviate account connect-session poll --session ${flags.session} --wait\n`,
  );
  process.exit(AUTH_NEEDED);
}

/**
 * Run `account reconnect <account_id> <body…>`.
 * Required: --account-id (positional), --auth-method.
 */
export async function runAccountReconnect(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
  io: CredentialIO = {},
): Promise<void> {
  if (!flags["auth-method"]) {
    out.stderr.write("error: --auth-method is required for account reconnect (credentials | cookie).\n");
    process.exit(2);
  }

  checkCredentialConflicts(flags, out);

  const accountId = flags["account-id"] ?? "";
  const resolvedIo = resolveCredentialIO(io);
  const body = await buildAuthBody(flags, {
    out,
    isTTY: resolvedIo.isTTY,
    readline: resolvedIo.readline,
    readStdin: resolvedIo.readStdin,
    previewMode: flags.preview ?? false,
  });
  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.reconnect",
      args: { accountId },
      body: maskCredentialSecretsForPreview(body),
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  let result: unknown;
  try {
    result = await client.accounts.reconnect(accountId, body);
  } catch (err) {
    await handleError(err, outOpts, out);
    return;
  }

  await handleAccountConnectResult(client, result, {
    out,
    flags,
    outOpts,
    io: resolvedIo,
    successVerb: "reconnected",
  });
}

/** Run `account refresh <account_id>`. */
export async function runAccountRefresh(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = flags["account-id"] ?? "";
  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.refresh",
      args: { accountId },
      body: {},
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.refresh(accountId);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `account update <account_id> <body…>`.
 * Body: optional proxy / country / ip.
 */
export async function runAccountUpdate(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = flags["account-id"] ?? "";
  const body: Record<string, unknown> = {};

  if (flags.country) body["country"] = flags.country;
  if (flags.ip) body["ip"] = flags.ip;
  if (flags["proxy-host"]) {
    // Proxy password is optional: flag > env > omitted — no prompt, no fail-fast.
    const proxyPassword = await resolveSecret({
      flagValue: flags["proxy-password"],
      envVar: "CURVIATE_PROXY_PASSWORD",
      out,
    });
    body["proxy"] = {
      protocol: flags["proxy-protocol"] ?? "http",
      host: flags["proxy-host"],
      port: flags["proxy-port"] ? parseInt(flags["proxy-port"], 10) : 80,
      ...(flags["proxy-username"] ? { username: flags["proxy-username"] } : {}),
      ...(proxyPassword !== undefined ? { password: proxyPassword } : {}),
    };
  }

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.update",
      args: { accountId },
      body: maskCredentialSecretsForPreview(body),
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.update(accountId, body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/** Run `account disconnect <account_id>`. */
export async function runAccountDisconnect(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  const accountId = flags["account-id"] ?? "";
  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.disconnect",
      args: { accountId },
      body: {},
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.disconnect(accountId);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/**
 * Run `account checkpoint submit <body…>`.
 * Body-addressed: checkpoint id in body as `account_id` (--checkpoint flag).
 * Required: --checkpoint (maps to body.account_id), --code.
 */
export async function runAccountCheckpointSubmit(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  if (!flags.checkpoint) {
    out.stderr.write("error: --checkpoint is required (the provisional account_id from the 202 response).\n");
    process.exit(2);
  }
  if (!flags.code) {
    out.stderr.write("error: --code is required (the OTP / 2FA code).\n");
    process.exit(2);
  }

  const body: Record<string, unknown> = {
    account_id: flags.checkpoint,
    code: flags.code,
  };

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.submitCheckpoint",
      args: {},
      body,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  let chained = false;
  try {
    const result = await client.accounts.submitCheckpoint(body);
    const r = result as CheckpointEnvelope;
    renderSuccess(result, outOpts, out);
    chained = r.status === "checkpoint_required";
  } catch (err) {
    await handleError(err, outOpts, out);
    return;
  }

  // A chained 202 (another challenge required) is a success response, not a
  // CurviateError — the exit call sits outside the try/catch above so it is
  // never miscaught and misrouted through handleError. Short-circuits the
  // one-shot command with AUTH_NEEDED (12): still resolvable, needs a further
  // `checkpoint submit` call for the new challenge_type.
  if (chained) {
    process.exit(AUTH_NEEDED);
  }
}

/**
 * Run `account checkpoint resend <body…>`.
 * Body-addressed: checkpoint id in body as `account_id` (--checkpoint flag).
 * Required: --checkpoint. No --code — resend has nothing to submit.
 *
 * Exit 0 on any 200 regardless of the `resent` boolean: a `false` value is an
 * honest answer ("this challenge type has nothing to re-send, or the
 * platform declined"), not a command failure — the caller reads `resent`
 * from the response to branch. Errors (404 no pending checkpoint, 409
 * expired, 501 unsupported) route through the standard exit-code table via
 * `handleError`, unchanged from `submit`/`poll`.
 */
export async function runAccountCheckpointResend(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
): Promise<void> {
  if (!flags.checkpoint) {
    out.stderr.write("error: --checkpoint is required (the provisional account_id from the 202 response).\n");
    process.exit(2);
  }

  const body: Record<string, unknown> = {
    account_id: flags.checkpoint,
  };

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.resendCheckpoint",
      args: {},
      body,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  try {
    const result = await client.accounts.resendCheckpoint(body);
    renderSuccess(result, outOpts, out);
  } catch (err) {
    await handleError(err, outOpts, out);
  }
}

/** Terminal outcome of the `checkpoint poll --wait` adaptive-cadence loop. */
type PollWaitOutcome =
  | { kind: "active"; result: unknown }
  | { kind: "terminal_failure"; status: "expired" | "failed"; result: unknown }
  | { kind: "timeout"; result: unknown };

/** "m:ss" countdown for the refreshing wait status line. */
function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The `checkpoint poll --wait` adaptive-cadence loop: the same cadence
 * (`lib/checkpoint-cadence.ts`) as the interactive mobile-approval sub-loop,
 * against the standalone poll body rather than a just-received 202 envelope.
 * The wall-clock bound is `timeoutOverrideMs` (the `--timeout` flag) when
 * given; otherwise it is read lazily off the first `pending` response's
 * `expires_at` (falling back to a 10-minute default if that response somehow
 * carries none), since a bare `checkpoint poll --wait` has no envelope of its
 * own to read an expiry from before the first poll.
 */
async function runCheckpointPollWaitLoop(
  client: MinimalClient,
  body: Record<string, unknown>,
  ctx: {
    out: OutputStreams;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    showTicker: boolean;
    timeoutOverrideMs?: number;
  },
): Promise<PollWaitOutcome> {
  const startedAt = ctx.now();
  let timeoutAt: number | undefined =
    ctx.timeoutOverrideMs !== undefined ? startedAt + ctx.timeoutOverrideMs : undefined;

  await ctx.sleep(CHECKPOINT_POLL_FIRST_DELAY_MS);

  for (;;) {
    const result = await client.accounts.pollCheckpoint(body);
    const r = result as { status?: string; expires_at?: string };

    if (r.status === "active") return { kind: "active", result };
    if (r.status === "expired" || r.status === "failed") {
      return { kind: "terminal_failure", status: r.status, result };
    }

    if (timeoutAt === undefined) {
      const expiresAtMs = r.expires_at ? new Date(r.expires_at).getTime() : NaN;
      timeoutAt = Number.isNaN(expiresAtMs) ? startedAt + 10 * 60_000 : expiresAtMs;
    }

    const n = ctx.now();
    if (n >= timeoutAt) return { kind: "timeout", result };

    if (ctx.showTicker) {
      ctx.out.stderr.write(`\rWaiting for approval… ${formatRemaining(timeoutAt - n)} remaining`);
    }

    await ctx.sleep(nextCheckpointPollDelayMs(n - startedAt));
  }
}

/**
 * Run `account checkpoint poll <body…> [--wait] [--timeout <ms>]`.
 * Body-addressed: checkpoint id in body as `account_id` (--checkpoint flag).
 * Required: --checkpoint.
 *
 * Without `--wait` (default): a single poll, unchanged (back-compat).
 * With `--wait`: the adaptive-cadence loop above, until `active` (exit 0),
 * `expired`/`failed` (exit 9), or the wait window elapses while still
 * `pending` (exit AUTH_NEEDED/12 — still resolvable, not a failure).
 */
export async function runAccountCheckpointPoll(
  client: MinimalClient,
  flags: AccountFlags,
  out: OutputStreams,
  io: CredentialIO = {},
): Promise<void> {
  if (!flags.checkpoint) {
    out.stderr.write("error: --checkpoint is required (the provisional account_id from the 202 response).\n");
    process.exit(2);
  }

  const body: Record<string, unknown> = {
    account_id: flags.checkpoint,
  };

  const outOpts = resolveOutputOpts(flags);

  if (flags.preview) {
    const preview = buildPreviewOutput({
      method: "accounts.pollCheckpoint",
      args: {},
      body,
    });
    out.stdout.write(JSON.stringify(preview) + "\n");
    return;
  }

  if (!flags.wait) {
    try {
      const result = await client.accounts.pollCheckpoint(body);
      renderSuccess(result, outOpts, out);
    } catch (err) {
      await handleError(err, outOpts, out);
    }
    return;
  }

  let timeoutOverrideMs: number | undefined;
  if (flags.timeout !== undefined) {
    const parsed = Number(flags.timeout);
    if (Number.isNaN(parsed)) {
      out.stderr.write("error: --timeout must be a number of milliseconds.\n");
      process.exit(2);
    }
    timeoutOverrideMs = parsed;
  }

  const resolvedIo = resolveCredentialIO(io);
  // "TTY + not --json" per the flag's own contract — the raw --json flag,
  // not resolveOutputOpts's derived json (which also folds in the real
  // process.stdout.isTTY and would make the ticker untestable: this
  // function's own isOutputTTY seam is what tests control).
  const showTicker = resolvedIo.isOutputTTY && !(flags.json ?? false);

  // Poll only ever addresses a mobile_app_approval checkpoint (a code-based
  // checkpoint 422s here — use `checkpoint submit` instead), so the resend
  // hint's per-type gating always resolves to "resendable" — printed once,
  // up front, not per attempt. Stderr diagnostic, not the stdout data
  // payload the "silent until terminal" discipline is about (mirrors
  // renderError's own one-liner-to-stderr-regardless-of-json convention).
  printResendHintIfApplicable("mobile_app_approval", flags.checkpoint, out);

  let outcome: PollWaitOutcome;
  try {
    outcome = await runCheckpointPollWaitLoop(client, body, {
      out,
      sleep: resolvedIo.sleep,
      now: resolvedIo.now,
      showTicker,
      timeoutOverrideMs,
    });
  } catch (err) {
    await handleError(err, outOpts, out);
    return;
  }

  if (outcome.kind === "active") {
    printConnected(outcome.result, { out, outOpts, successVerb: "linked" });
    return;
  }
  if (outcome.kind === "terminal_failure") {
    renderSuccess(outcome.result, outOpts, out);
    out.stderr.write(`This checkpoint has ${outcome.status}. Start over: curviate account link or curviate account reconnect.\n`);
    process.exit(9);
    return;
  }
  // outcome.kind === "timeout"
  renderSuccess(outcome.result, outOpts, out);
  out.stderr.write(
    `Still waiting for approval — the wait window elapsed. Check again: curviate account checkpoint poll --checkpoint ${flags.checkpoint} --wait\n`,
  );
  process.exit(AUTH_NEEDED);
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const accountListCommand = defineCommand({
  meta: { name: "list", description: "List connected LinkedIn accounts." },
  args: { ...GLOBAL_FLAGS },
  async run({ args }) {
    const flags = args as AccountFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountList(client as unknown as MinimalClient, flags, out);
  },
});

const accountGetCommand = defineCommand({
  meta: { name: "get", description: "Get a connected LinkedIn account." },
  args: {
    // Single-object read: READ_SINGLE_FLAGS omits pagination flags, keeps --fields
    ...READ_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountGet(client as unknown as MinimalClient, flags, out);
  },
});

const accountLinkCommand = defineCommand({
  meta: {
    name: "link",
    description:
      "Connect a LinkedIn account to an empty seat. " +
      "If LinkedIn requires verification you'll be prompted for the code interactively; in a non-interactive shell the command exits 12 and you finish with `curviate account checkpoint submit`.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "seat-id": { type: "string", description: "Empty seat to bind the account to.", required: true },
    "auth-method": { type: "string", description: "Authentication method: credentials | cookie.", required: true },
    email: { type: "string", description: "LinkedIn email (credentials method)." },
    password: { type: "string", description: `LinkedIn password (credentials method). ${PW_WARNING("--password-stdin", "CURVIATE_LINKEDIN_PASSWORD")}` },
    "password-stdin": { type: "boolean", description: "Read the LinkedIn password from stdin (one line, trimmed).", default: false },
    "li-at": { type: "string", description: `LinkedIn session cookie li_at (cookie method). ${PW_WARNING("--li-at-stdin", "CURVIATE_LINKEDIN_LI_AT")}` },
    "li-at-stdin": { type: "boolean", description: "Read the li_at session cookie from stdin (one line, trimmed).", default: false },
    "li-a": { type: "string", description: `Optional premium session cookie li_a (cookie method). ${OPTIONAL_SECRET_WARNING("CURVIATE_LINKEDIN_LI_A")}` },
    country: { type: "string", description: "Proxy location hint (ISO 3166-1 alpha-2)." },
    ip: { type: "string", description: "IP to infer the managed proxy location." },
    "proxy-protocol": { type: "string", description: "Proxy protocol: http | https | socks5." },
    "proxy-host": { type: "string", description: "Proxy host or IP." },
    "proxy-port": { type: "string", description: "Proxy port." },
    "proxy-username": { type: "string", description: "Proxy auth username." },
    "proxy-password": { type: "string", description: `Proxy auth password. ${OPTIONAL_SECRET_WARNING("CURVIATE_PROXY_PASSWORD")}` },
    "user-agent": { type: "string", description: "Browser User-Agent to pin for this account." },
    "recruiter-contract-id": { type: "string", description: "Recruiter contract to bind to (Recruiter tier only)." },
    "no-interactive": {
      type: "boolean",
      description: "Never prompt for a checkpoint code — on a checkpoint, always render the envelope and exit 12, even on a TTY.",
      default: false,
    },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountLink(client as unknown as MinimalClient, flags, out);
  },
});

const accountConnectLinkCommand = defineCommand({
  meta: {
    name: "connect-link",
    description:
      "Generate a one-time hosted account connection URL. On an interactive TTY the URL auto-opens in " +
      "your browser and the command waits for the account to connect (exit 0 on success, 9 if the link " +
      "expires or fails, 12 if the wait window elapses first). Non-interactively it never opens a browser " +
      "and returns immediately with the url and session_id — poll completion later with " +
      "`account connect-session poll`.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "seat-id": { type: "string", description: "Target seat (required when purpose=create)." },
    "account-id": { type: "string", description: "Account to reconnect (required when purpose=reconnect)." },
    purpose: { type: "string", description: "create | reconnect (default: create)." },
    "expires-in-seconds": { type: "string", description: "Link expiry in seconds (60–3600, default 900)." },
    "redirect-url": { type: "string", description: "Browser return URL after the hosted flow." },
    open: {
      type: "boolean",
      description: "Auto-open the URL in your default browser. Default: on for an interactive TTY, always off otherwise (ignored non-interactively).",
    },
    wait: {
      type: "boolean",
      description: "Poll for the account to connect on an adaptive cadence (1000ms, then 1500ms for 30s, then 3000ms) after opening the URL. Default: on for an interactive TTY, always off otherwise (the agent polls later via `account connect-session poll`).",
    },
    // Override WRITE_SINGLE_FLAGS.timeout: on this command --timeout is the
    // TTY+interactive wait loop's own wall-clock bound in MILLISECONDS
    // (meaningless outside that branch) — NOT the SDK request timeout.
    // Default: the time remaining to the link's own expiry.
    timeout: {
      type: "string",
      description: "Wait-loop timeout in milliseconds (only meaningful under the interactive TTY wait; default: time remaining to the link's expiry). Note the unit: this is milliseconds.",
    },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    // --timeout here means the wait-loop bound (ms), not the SDK request
    // timeout — resolve config without it so the SDK client keeps its
    // default request timeout (mirrors `account checkpoint poll`'s identical
    // flag-name collision fix).
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountConnectLink(client as unknown as MinimalClient, flags, out);
  },
});

const accountConnectSessionPollCommand = defineCommand({
  meta: {
    name: "poll",
    description:
      "Poll a hosted connect-link session for completion. Without --wait: a single poll — the JSON " +
      "`status` field (pending | resolved | expired | failed) tells you what to do next. With --wait: " +
      "block on the same adaptive cadence as `account connect-link` until a terminal state.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    session: {
      type: "string",
      description: "The session_id returned by `account connect-link`.",
      required: true,
    },
    wait: {
      type: "boolean",
      description: "Poll on an adaptive cadence (1000ms, then 1500ms for 30s, then 3000ms) until a terminal state, instead of a single poll.",
      default: false,
    },
    // Override WRITE_SINGLE_FLAGS.timeout: on this command --timeout is the
    // --wait loop's own wall-clock bound in MILLISECONDS (requires --wait) —
    // NOT the SDK request timeout. Default: the time remaining to the
    // session's own expiry.
    timeout: {
      type: "string",
      description: "Wait-loop timeout in milliseconds (requires --wait; default: time remaining to the session's expiry). Note the unit: this is milliseconds.",
    },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    // --timeout here means the --wait bound (ms), not the SDK request
    // timeout — resolve config without it (same fix as `account checkpoint
    // poll` / `account connect-link`).
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountConnectSessionPoll(client as unknown as MinimalClient, flags, out);
  },
});

const accountConnectSessionCommand = defineCommand({
  meta: { name: "connect-session", description: "Hosted connect-link session operations (poll for completion)." },
  subCommands: {
    poll: accountConnectSessionPollCommand,
  },
  async run() {
    process.stderr.write("Usage: curviate account connect-session poll --session <session_id>\n");
  },
});

const accountReconnectCommand = defineCommand({
  meta: {
    name: "reconnect",
    description:
      "Re-authorize a disconnected account in place. " +
      "If LinkedIn requires verification you'll be prompted for the code interactively; in a non-interactive shell the command exits 12 and you finish with `curviate account checkpoint submit`.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
    "auth-method": { type: "string", description: "Authentication method: credentials | cookie.", required: true },
    email: { type: "string", description: "LinkedIn email (credentials method)." },
    password: { type: "string", description: `LinkedIn password (credentials method). ${PW_WARNING("--password-stdin", "CURVIATE_LINKEDIN_PASSWORD")}` },
    "password-stdin": { type: "boolean", description: "Read the LinkedIn password from stdin (one line, trimmed).", default: false },
    "li-at": { type: "string", description: `LinkedIn session cookie li_at (cookie method). ${PW_WARNING("--li-at-stdin", "CURVIATE_LINKEDIN_LI_AT")}` },
    "li-at-stdin": { type: "boolean", description: "Read the li_at session cookie from stdin (one line, trimmed).", default: false },
    "li-a": { type: "string", description: `Optional premium session cookie li_a (cookie method). ${OPTIONAL_SECRET_WARNING("CURVIATE_LINKEDIN_LI_A")}` },
    country: { type: "string", description: "Proxy location hint (ISO 3166-1 alpha-2)." },
    ip: { type: "string", description: "IP to infer the managed proxy location." },
    "proxy-protocol": { type: "string", description: "Proxy protocol: http | https | socks5." },
    "proxy-host": { type: "string", description: "Proxy host or IP." },
    "proxy-port": { type: "string", description: "Proxy port." },
    "proxy-username": { type: "string", description: "Proxy auth username." },
    "proxy-password": { type: "string", description: `Proxy auth password. ${OPTIONAL_SECRET_WARNING("CURVIATE_PROXY_PASSWORD")}` },
    "user-agent": { type: "string", description: "Browser User-Agent to pin." },
    "recruiter-contract-id": { type: "string", description: "Recruiter contract id (Recruiter tier only)." },
    "no-interactive": {
      type: "boolean",
      description: "Never prompt for a checkpoint code — on a checkpoint, always render the envelope and exit 12, even on a TTY.",
      default: false,
    },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountReconnect(client as unknown as MinimalClient, flags, out);
  },
});

const accountRefreshCommand = defineCommand({
  meta: { name: "refresh", description: "Refresh an account's synced data sources." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountRefresh(client as unknown as MinimalClient, flags, out);
  },
});

const accountUpdateCommand = defineCommand({
  meta: { name: "update", description: "Update managed-proxy configuration for an account." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
    country: { type: "string", description: "Proxy location hint (ISO 3166-1 alpha-2)." },
    ip: { type: "string", description: "IP to infer the managed proxy location." },
    "proxy-protocol": { type: "string", description: "Proxy protocol: http | https | socks5." },
    "proxy-host": { type: "string", description: "Proxy host or IP." },
    "proxy-port": { type: "string", description: "Proxy port." },
    "proxy-username": { type: "string", description: "Proxy auth username." },
    "proxy-password": { type: "string", description: `Proxy auth password. ${OPTIONAL_SECRET_WARNING("CURVIATE_PROXY_PASSWORD")}` },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountUpdate(client as unknown as MinimalClient, flags, out);
  },
});

const accountDisconnectCommand = defineCommand({
  meta: { name: "disconnect", description: "Hard-disconnect a LinkedIn account and release its seat." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    "account-id": { type: "positional", description: "Account id (acc_…)." },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountDisconnect(client as unknown as MinimalClient, flags, out);
  },
});

const accountCheckpointSubmitCommand = defineCommand({
  meta: { name: "submit", description: "Submit an OTP / 2FA code to resolve a checkpoint challenge." },
  args: {
    ...WRITE_SINGLE_FLAGS,
    checkpoint: {
      type: "string",
      description: "The provisional account_id from the 202 checkpoint_required response.",
      required: true,
    },
    code: {
      type: "string",
      description: "The OTP / 2FA verification code.",
      required: true,
    },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountCheckpointSubmit(client as unknown as MinimalClient, flags, out);
  },
});

const accountCheckpointPollCommand = defineCommand({
  meta: {
    name: "poll",
    description:
      "Poll for mobile-app approval of a pending checkpoint challenge. " +
      "With --wait, blocks on an adaptive cadence until a terminal state (or --timeout elapses) instead of a single poll.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    checkpoint: {
      type: "string",
      description: "The provisional account_id from the 202 checkpoint_required response.",
      required: true,
    },
    wait: {
      type: "boolean",
      description: "Poll on an adaptive cadence (1000ms, then 1500ms for 30s, then 3000ms) until a terminal state, instead of a single poll.",
      default: false,
    },
    // Override WRITE_SINGLE_FLAGS.timeout: on this command --timeout is the
    // --wait loop's own wall-clock bound in MILLISECONDS (requires --wait) —
    // NOT the SDK request timeout, and NOT seconds like `inbox sync-chat
    // --timeout`. Default: the time remaining to the checkpoint's own expiry.
    timeout: {
      type: "string",
      description: "Wait-loop timeout in milliseconds (requires --wait; default: time remaining to the checkpoint's expiry). Note the unit: this is milliseconds — `inbox sync-chat --timeout` is seconds.",
    },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    // --timeout here means the --wait bound (ms), not the SDK request
    // timeout — resolve config without it so the SDK client keeps its
    // default request timeout (mirrors `inbox sync-chat`'s own fix for the
    // identical flag-name collision).
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountCheckpointPoll(client as unknown as MinimalClient, flags, out);
  },
});

const accountCheckpointResendCommand = defineCommand({
  meta: {
    name: "resend",
    description:
      "Re-send the challenge notification for a pending checkpoint (e.g. re-send an OTP email, SMS " +
      "code, or mobile-app approval push). Not every challenge type supports resend — an authenticator- " +
      "app code has nothing to re-send. The response's `resent` boolean tells you honestly whether a new " +
      "notification actually went out; the command still exits 0 either way.",
  },
  args: {
    ...WRITE_SINGLE_FLAGS,
    checkpoint: {
      type: "string",
      description: "The provisional account_id from the 202 checkpoint_required response.",
      required: true,
    },
  },
  async run({ args }) {
    const flags = args as AccountFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runAccountCheckpointResend(client as unknown as MinimalClient, flags, out);
  },
});

const accountCheckpointCommand = defineCommand({
  meta: {
    name: "checkpoint",
    description: "Checkpoint challenge operations (submit OTP, poll mobile-app approval, or resend the challenge notification).",
  },
  subCommands: {
    submit: accountCheckpointSubmitCommand,
    poll: accountCheckpointPollCommand,
    resend: accountCheckpointResendCommand,
  },
  async run() {
    process.stderr.write("Usage: curviate account checkpoint submit | poll | resend\n");
  },
});

export const accountCommand = defineCommand({
  meta: { name: "account", description: "LinkedIn account connection management." },
  subCommands: {
    list: accountListCommand,
    get: accountGetCommand,
    link: accountLinkCommand,
    "connect-link": accountConnectLinkCommand,
    "connect-session": accountConnectSessionCommand,
    reconnect: accountReconnectCommand,
    refresh: accountRefreshCommand,
    update: accountUpdateCommand,
    disconnect: accountDisconnectCommand,
    checkpoint: accountCheckpointCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate account <subcommand>\n" +
      "  list | get | link | connect-link | connect-session poll | reconnect | refresh | update | disconnect | checkpoint\n",
    );
  },
});
