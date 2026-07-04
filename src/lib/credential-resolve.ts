/**
 * LinkedIn-account credential resolution.
 *
 * These are the secrets a customer supplies to connect/reconnect a LinkedIn
 * account (a password, a session cookie pair, an optional managed-proxy
 * password) — distinct from the Curviate API key (see `lib/resolve.ts`).
 * They are pass-through only: they land in exactly one place (the request
 * body assembled by the caller) and are never persisted client-side, logged,
 * or echoed.
 *
 * Resolution order per secret (highest wins):
 *   1. an explicit value flag, XOR its `--*-stdin` sibling
 *   2. an environment variable
 *   3. (required, prompt-eligible secrets only) a masked TTY prompt
 *   4. fail fast — never silently send an empty/missing required secret,
 *      never block reading stdin unless the caller explicitly asked for it
 *
 * An explicitly empty source (`--password ""` or `MY_ENV=""`) is treated as
 * no source at all and falls through to the next tier.
 */

import { defaultReadStdin } from "./stdin.js";

export interface OutStreams {
  stderr: { write: (s: string) => void };
}

export interface ResolveSecretPrompt {
  /** stdin.isTTY — injectable so tests never touch the real terminal. */
  isTTY: boolean;
  /** Injectable masked-prompt function (production: `lib/readline.ts`'s `readlineSync`). */
  readline: (prompt: string, opts?: { mask?: boolean }) => Promise<string>;
  promptText: string;
}

export interface ResolveSecretParams {
  /** The `--<flag>` value, if provided. */
  flagValue?: string;
  /** Whether the paired `--<flag>-stdin` boolean was passed. */
  stdinRequested?: boolean;
  /** Env var name checked at tier 2. */
  envVar: string;
  /** Injectable stdin reader (production: `lib/stdin.ts`'s `defaultReadStdin`). */
  readStdin?: () => Promise<string>;
  /** Whether this secret must resolve to something (password, li_at) or may be omitted (li_a, proxy password). Default false. */
  required?: boolean;
  /** Error message written to stderr before exiting 2 when a required secret has no source. */
  failMessage?: string;
  /** Masked-prompt fallback — only ever supplied for the `credentials` password. */
  prompt?: ResolveSecretPrompt;
  /**
   * When false, tiers 3 (prompt) and 4 (fail-fast exit) are skipped even for
   * a required secret with nothing resolved — the caller gets `undefined`
   * back instead. Used for `--preview` (a client-side render must never
   * prompt or exit) and for a `credentials` call still missing `--email`
   * (nothing meaningful to prompt toward yet). Default true.
   */
  allowInteractive?: boolean;
  out: OutStreams;
}

/**
 * Resolve one LinkedIn-account secret through the flag/stdin/env/prompt
 * tiers described above. Returns `undefined` for an optional secret with no
 * source; exits 2 (after writing `failMessage`) for a required secret with
 * no source when interactive fallbacks are exhausted or disallowed.
 */
export async function resolveSecret(params: ResolveSecretParams): Promise<string | undefined> {
  // Tier 1a: value flag (non-empty).
  if (params.flagValue !== undefined && params.flagValue !== "") {
    return params.flagValue;
  }

  // Tier 1b: stdin (mutually exclusive with the value flag — conflicts are
  // rejected upstream by checkCredentialConflicts before resolution starts).
  if (params.stdinRequested) {
    const reader = params.readStdin ?? defaultReadStdin;
    const raw = await reader();
    const trimmed = raw.trim();
    if (trimmed !== "") {
      return trimmed;
    }
    // An explicitly requested-but-empty stdin read falls through, same as
    // an explicitly empty flag/env value — never silently send "".
  }

  // Tier 2: environment variable (non-empty).
  const envValue = process.env[params.envVar];
  if (envValue !== undefined && envValue !== "") {
    return envValue;
  }

  // Optional secret: flag > env > omitted. No prompt, no fail-fast.
  if (!params.required) {
    return undefined;
  }

  // Interactive fallbacks suppressed (preview render, or a gating condition
  // like "no --email yet" upstream) — return undefined rather than prompt
  // or exit, so a client-side render never blocks or fails.
  if (params.allowInteractive === false) {
    return undefined;
  }

  // Tier 3: masked TTY prompt (password only — `prompt` is only ever passed
  // for the credentials-method password; the cookie method has none).
  if (params.prompt && params.prompt.isTTY) {
    const value = await params.prompt.readline(params.prompt.promptText, { mask: true });
    if (value) {
      return value;
    }
    // A blank prompt entry falls straight to the fail-fast below — this is
    // not a re-prompt loop.
  }

  // Tier 4: fail fast. Never read stdin here — the read only ever happens
  // in the stdinRequested branch above, so a non-interactive caller with no
  // source can never hang.
  params.out.stderr.write(`error: ${params.failMessage ?? "missing required credential"}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Conflict matrix
// ---------------------------------------------------------------------------

export interface CredentialConflictFlags {
  password?: string;
  "password-stdin"?: boolean;
  "li-at"?: string;
  "li-at-stdin"?: boolean;
  "auth-method"?: string;
}

/**
 * Reject the 5 stdin/flag conflict combinations as usage errors (exit 2,
 * zero SDK/network calls) before any resolution begins:
 *   1. `--password` and `--password-stdin` together.
 *   2. `--li-at` and `--li-at-stdin` together.
 *   3. `--password-stdin` and `--li-at-stdin` together (stdin feeds one secret).
 *   4. `--li-at-stdin` with `--auth-method credentials` (mismatched secret).
 *   5. `--password-stdin` with `--auth-method cookie` (mismatched secret).
 */
export function checkCredentialConflicts(flags: CredentialConflictFlags, out: OutStreams): void {
  const passwordStdin = flags["password-stdin"] ?? false;
  const liAtStdin = flags["li-at-stdin"] ?? false;

  if (flags.password !== undefined && passwordStdin) {
    failConflict(out, "--password and --password-stdin cannot both be set — choose one source.");
  }
  if (flags["li-at"] !== undefined && liAtStdin) {
    failConflict(out, "--li-at and --li-at-stdin cannot both be set — choose one source.");
  }
  if (passwordStdin && liAtStdin) {
    failConflict(
      out,
      "--password-stdin and --li-at-stdin cannot both be set — stdin can feed only one secret per invocation.",
    );
  }
  if (liAtStdin && flags["auth-method"] === "credentials") {
    failConflict(out, "--li-at-stdin requires --auth-method cookie (it does not apply to the credentials method).");
  }
  if (passwordStdin && flags["auth-method"] === "cookie") {
    failConflict(out, "--password-stdin requires --auth-method credentials (it does not apply to the cookie method).");
  }
}

function failConflict(out: OutStreams, message: string): never {
  out.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// --preview secret masking
// ---------------------------------------------------------------------------

const SECRET_MASK = "••••";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Return a copy of a request body with every known LinkedIn-credential
 * field (`credentials.password`, `cookie.li_at`, `cookie.li_a`,
 * `proxy.password`) replaced by a fixed mask, for `--preview` rendering.
 * Never mutates the input — the real (unmasked) body still goes to the
 * actual SDK call on a non-preview run.
 */
export function maskCredentialSecretsForPreview(body: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...body };

  const credentials = masked["credentials"];
  if (isRecord(credentials) && "password" in credentials) {
    masked["credentials"] = { ...credentials, password: SECRET_MASK };
  }

  const cookie = masked["cookie"];
  if (isRecord(cookie)) {
    const maskedCookie = { ...cookie };
    if ("li_at" in maskedCookie) maskedCookie["li_at"] = SECRET_MASK;
    if ("li_a" in maskedCookie) maskedCookie["li_a"] = SECRET_MASK;
    masked["cookie"] = maskedCookie;
  }

  const proxy = masked["proxy"];
  if (isRecord(proxy) && "password" in proxy) {
    masked["proxy"] = { ...proxy, password: SECRET_MASK };
  }

  return masked;
}
