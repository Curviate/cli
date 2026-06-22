/**
 * Global flags inherited by every command in the CLI.
 *
 * Declared once here and merged into each leaf command's argument schema, so
 * `curviate <anything> --json --account acc_1` parses identically regardless
 * of which command is running.
 *
 * Semantics of each flag are owned by the relevant sub-system:
 *   --account / --api-key / --profile  → lib/resolve.ts (auth & config)
 *   --json / --fields / --limit / --cursor / --all / --max-pages → lib/output.ts
 *   --preview                           → lib/preview.ts
 *   --base-url / --timeout              → lib/resolve.ts
 */

export const GLOBAL_FLAGS = {
  // Auth / config
  "api-key": {
    type: "string" as const,
    description:
      "API key (overrides env and profile). Note: a key passed on the command line is visible to other processes via `ps` and is saved in shell history; prefer the CURVIATE_API_KEY env var or `curviate login`.",
  },
  profile: {
    type: "string" as const,
    description: "Named profile to use from the config file.",
  },
  account: {
    type: "string" as const,
    description: "Account id for account-scoped commands.",
  },
  "base-url": {
    type: "string" as const,
    description: "Override the API base URL.",
  },
  timeout: {
    type: "string" as const,
    description: "Request timeout in milliseconds.",
  },
  // Output
  json: {
    type: "boolean" as const,
    description: "Emit JSON output (default when stdout is not a TTY).",
    default: false,
  },
  fields: {
    type: "string" as const,
    description: "Comma-separated dot-path field projection (e.g. id,name).",
  },
  limit: {
    type: "string" as const,
    description: "Maximum items per page.",
  },
  cursor: {
    type: "string" as const,
    description: "Pagination cursor (opaque token from a previous response).",
  },
  all: {
    type: "boolean" as const,
    description: "Stream all pages as NDJSON.",
    default: false,
  },
  "max-pages": {
    type: "string" as const,
    description: "Maximum number of pages to fetch when --all is used.",
  },
  preview: {
    type: "boolean" as const,
    description:
      "Render the request that would be sent without calling the API.",
    default: false,
  },
} as const;

export type GlobalFlags = {
  "api-key"?: string;
  profile?: string;
  account?: string;
  "base-url"?: string;
  timeout?: string;
  json?: boolean;
  fields?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  "max-pages"?: string;
  preview?: boolean;
};
