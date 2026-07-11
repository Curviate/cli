/**
 * `curviate job` — public job posting retrieval.
 *
 * Subcommands:
 *   job get <url|id>   — retrieve one public job posting's full detail (read)
 *
 * Account-scoped. The positional accepts a full LinkedIn job URL or a bare
 * numeric id — resolved client-side via `resolveJobIdentifier`; a value that
 * does not match the URL pattern passes through unchanged and the SDK's own
 * job-id resolution is the fallback validator.
 *
 * Read command: --preview is a usage error (exit 2).
 *
 * Slim projection (default): object, id, title, company, company_id,
 * location, state, applicants_counter, published_at, description. Pass
 * --verbose for the full SDK response (adds cost, created_at, hiring_team).
 */

import { defineCommand } from "citty";
import { READ_SINGLE_FLAGS } from "../lib/global-flags.js";
import { resolveJobIdentifier } from "../lib/identifier.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { slimJob } from "../lib/slim.js";
import type { Curviate, CurviateError } from "@curviate/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JobFlags = {
  id?: string;
  account?: string;
  json?: boolean;
  fields?: string;
  preview?: boolean;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
  verbose?: boolean;
};

type OutputStreams = {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildOutputStreams(): OutputStreams {
  return {
    stdout: { write: (s: string) => process.stdout.write(s) },
    stderr: { write: (s: string) => process.stderr.write(s) },
  };
}

function requireAccount(account: string | undefined, out: OutputStreams): string {
  if (!account) {
    out.stderr.write("error: --account is required for this command. Set it via --account, CURVIATE_ACCOUNT, or `curviate config set-account`.\n");
    process.exit(2);
  }
  return account;
}

function resolveOutputOpts(flags: JobFlags) {
  return {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
    verbose: flags.verbose ?? false,
  };
}

// ---------------------------------------------------------------------------
// Exported run functions (testable without citty)
// ---------------------------------------------------------------------------

/**
 * Run `job get <url|id>`.
 * Read command — rejects --preview (exit 2), no SDK call is made in that case.
 * Exported for unit-testing.
 */
export async function runJobGet(
  client: Curviate,
  flags: JobFlags,
  out: OutputStreams,
): Promise<void> {
  if (flags.preview) {
    out.stderr.write("error: --preview is only valid on write commands (mutations). Reads just run.\n");
    process.exit(2);
  }

  const accountId = requireAccount(flags.account, out);
  const rawId = flags.id ?? "";
  const resolvedId = resolveJobIdentifier(rawId);
  const ns = client.account(accountId);
  const outOpts = resolveOutputOpts(flags);

  try {
    const result = await ns.jobs.get(resolvedId);
    renderSuccess(result, { ...outOpts, slim: slimJob }, out);
  } catch (err: unknown) {
    const { CurviateError } = await import("@curviate/sdk");
    if (err instanceof CurviateError) {
      const { getExitCode } = await import("../lib/exit-codes.js");
      renderError(err as CurviateError, outOpts, out);
      process.exit(getExitCode(err.code));
    }
    renderUnexpectedError(err, out);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Citty command definitions
// ---------------------------------------------------------------------------

const jobGetCommand = defineCommand({
  meta: { name: "get", description: "Retrieve one public LinkedIn job posting's full detail." },
  args: {
    ...READ_SINGLE_FLAGS,
    id: { type: "positional", description: "Job URL (e.g. https://www.linkedin.com/jobs/view/4428113858) or a bare numeric job id." },
  },
  async run({ args }) {
    const flags = args as JobFlags;
    const cfg = await resolveEffectiveConfig({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      timeout: flags.timeout,
      account: flags.account,
      profile: flags.profile,
    });
    if (!cfg.apiKey) {
      process.stderr.write("error: no API key — run `curviate login` or pass --api-key.\n");
      process.exit(3);
    }
    const client = createClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeout: cfg.timeout });
    const out = buildOutputStreams();
    await runJobGet(client, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});

export const jobCommand = defineCommand({
  meta: { name: "job", description: "Public LinkedIn job posting operations." },
  args: { ...READ_SINGLE_FLAGS },
  subCommands: {
    get: jobGetCommand,
  },
  async run() {
    process.stderr.write(
      "Usage: curviate job get <url|id>\n",
    );
  },
});
