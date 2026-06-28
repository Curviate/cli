/**
 * `curviate company <id>` — fetch a company profile.
 *
 * Routes to `profiles.getCompany(slug)`. The `<id>` positional passes through
 * `resolveIdentifier` to handle company URLs, bare paths, and slugs.
 * This is a read command: --preview and --all are usage errors (exit 2).
 */

import { defineCommand } from "citty";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { resolveIdentifier } from "../lib/identifier.js";
import { resolveEffectiveConfig } from "../lib/resolve.js";
import { createClient } from "../lib/client.js";
import { renderSuccess, renderError, renderUnexpectedError } from "../lib/output.js";
import { slimCompany } from "../lib/slim.js";
import type { CurviateError } from "@curviate/sdk";

type CompanyFlags = {
  id?: string;
  account?: string;
  json?: boolean;
  fields?: string;
  preview?: boolean;
  all?: boolean;
  limit?: string;
  cursor?: string;
  "max-pages"?: string;
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

type MinimalClient = {
  account: (id: string) => {
    profiles: {
      getCompany: (id: string) => Promise<unknown>;
    };
  };
  profiles: {
    getCompany: (id: string) => Promise<unknown>;
  };
};

function buildOutputStreams(): OutputStreams {
  return {
    stdout: { write: (s: string) => process.stdout.write(s) },
    stderr: { write: (s: string) => process.stderr.write(s) },
  };
}

/**
 * Run `company <id>`.
 * Exported for unit-testing.
 *
 * Note: `profiles.getCompany` is not account-scoped (no account_id in the
 * request). The SDK mounts it on the account-scoped context for convenience
 * but the endpoint itself does not require an account_id. The CLI uses
 * `client.account(accountId).profiles.getCompany` when an account is
 * available, or falls back to a top-level call.
 */
export async function runCompanyGet(
  client: MinimalClient,
  flags: CompanyFlags,
  out: OutputStreams,
): Promise<void> {
  if (flags.preview) {
    out.stderr.write("error: --preview is only valid on write commands (mutations). Reads just run.\n");
    process.exit(2);
  }
  if (flags.all) {
    out.stderr.write("error: --all is not supported on non-paginated commands.\n");
    process.exit(2);
  }

  const rawId = flags.id ?? "";
  const resolvedId = resolveIdentifier(rawId);

  const outOpts = {
    json: (flags.json ?? false) || !process.stdout.isTTY,
    isTTY: process.stdout.isTTY ?? false,
    fields: flags.fields,
    verbose: flags.verbose ?? false,
    slim: slimCompany,
  };

  try {
    // Use account-scoped accessor when an account is available, otherwise top-level.
    const getCompany = flags.account
      ? client.account(flags.account).profiles.getCompany.bind(client.account(flags.account).profiles)
      : client.profiles.getCompany.bind(client.profiles);
    const result = await getCompany(resolvedId);
    renderSuccess(result, outOpts, out);
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

export const companyCommand = defineCommand({
  meta: { name: "company", description: "Fetch a company profile by URL or slug." },
  args: {
    ...GLOBAL_FLAGS,
    id: { type: "positional", description: "Company identifier (URL, slug, or native id)." },
  },
  async run({ args }) {
    const flags = args as CompanyFlags;
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
    await runCompanyGet(client as unknown as MinimalClient, { ...flags, account: flags.account ?? cfg.account }, out);
  },
});
