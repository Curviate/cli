/**
 * Output, projection, and error rendering for the CLI.
 *
 * Stream discipline:
 *   stdout = data only (success results, --preview render, JSON error envelope)
 *   stderr = diagnostics, progress, human chrome, one-line error summaries
 *
 * JSON mode is active when `--json` is passed OR stdout is not a TTY
 * (agent-first: default JSON on pipe).
 *
 * `--fields` projection: dot-path projection over response objects. For
 * arrays, projection is applied per-item. Missing paths are omitted (not null).
 *
 * Error output:
 *   JSON mode: `{ "error": <CurviateError.toJSON()> }` to stdout; one-liner to stderr.
 *   Human mode: readable error to stderr; stdout stays empty.
 */

import type { CurviateError, CurviateErrorJSON } from "@curviate/sdk";

export interface OutputOptions {
  json: boolean;
  isTTY: boolean;
  fields?: string;
  /** When true, bypass slim projection and return the raw SDK response. */
  verbose?: boolean;
  /** Command-specific slim projector. Applied before --fields unless --verbose. */
  slim?: (data: unknown) => unknown;
}

export interface OutputStreams {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

/** Determine whether the current invocation should use JSON mode. */
export function isJsonMode(opts: { json: boolean; isTTY: boolean }): boolean {
  return opts.json || !opts.isTTY;
}

/**
 * Apply dot-path field projection to a single object.
 * Missing paths are omitted (not set to null).
 */
export function projectFields(
  obj: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  if (fields.length === 0) return obj;

  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const parts = field.split(".");
    let value: unknown = obj;
    for (const part of parts) {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }
    if (value !== undefined) {
      // For dot-path fields, use the full path as the key in output
      result[field] = value;
    }
  }
  return result;
}

/** Apply projection to a value (handles arrays with per-item projection). */
function applyProjection(
  data: unknown,
  fields: string[],
): unknown {
  if (fields.length === 0) return data;

  if (Array.isArray(data)) {
    return data.map((item) =>
      typeof item === "object" && item !== null
        ? projectFields(item as Record<string, unknown>, fields)
        : item,
    );
  }

  // For objects with an `items` array, project each item
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj["items"])) {
      return {
        ...obj,
        items: (obj["items"] as unknown[]).map((item) =>
          typeof item === "object" && item !== null
            ? projectFields(item as Record<string, unknown>, fields)
            : item,
        ),
      };
    }
    // Single object: project it directly
    return projectFields(obj, fields);
  }

  return data;
}

/**
 * Render a successful command response to the output streams.
 *
 * JSON mode: prints `JSON.stringify(data)` (verbatim SDK response) to stdout.
 * Human mode: renders a readable form to stdout (tables/key-value).
 *
 * Slim projection (when `opts.slim` is provided and `opts.verbose` is falsy):
 *   applied first, then `--fields` projection is applied on top. This keeps
 *   the default output compact while still allowing callers to select a subset
 *   of the slim fields via `--fields`.
 *
 * When `opts.verbose` is true, slim is bypassed and the raw SDK response is used.
 * Existing calls without `slim` or `verbose` are backward-compatible.
 */
export function renderSuccess(
  data: unknown,
  opts: OutputOptions,
  out: OutputStreams,
): void {
  const json = isJsonMode(opts);
  const fields = opts.fields
    ? opts.fields.split(",").map((f) => f.trim()).filter(Boolean)
    : [];

  // Apply slim projection first (before --fields), unless --verbose
  const slimmed = (!opts.verbose && opts.slim) ? opts.slim(data) : data;
  const projected = applyProjection(slimmed, fields);

  if (json) {
    out.stdout.write(JSON.stringify(projected) + "\n");
  } else {
    // Human-readable output: best-effort, not a stability contract.
    out.stdout.write(renderHuman(projected) + "\n");
  }
}

/** Render a human-readable representation of data (best-effort). */
function renderHuman(data: unknown): string {
  if (data === null || data === undefined) return "(empty)";

  if (typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;

    // List response with items
    if (Array.isArray(obj["items"])) {
      const items = obj["items"] as unknown[];
      if (items.length === 0) return "(no items)";
      return items.map(renderHuman).join("\n");
    }

    // Single object: key=value pairs
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join("\n");
  }

  if (Array.isArray(data)) {
    return data.map(renderHuman).join("\n");
  }

  return String(data);
}

export interface ErrorOutputOptions {
  json: boolean;
  isTTY: boolean;
}

/**
 * Render a CurviateError to the output streams.
 *
 * JSON mode: `{ "error": <error.toJSON()> }` to stdout; one-liner to stderr.
 * Human mode: readable error to stderr; stdout stays empty.
 *
 * The API key is never included (the SDK's toJSON() is credential-safe).
 */
export function renderError(
  err: CurviateError,
  opts: ErrorOutputOptions,
  out: OutputStreams,
): void {
  const json = isJsonMode(opts);
  const errJson: CurviateErrorJSON = err.toJSON();

  if (json) {
    // Structured error envelope to stdout (agent-first: agents read stdout).
    out.stdout.write(JSON.stringify({ error: errJson }) + "\n");
    // Brief one-liner to stderr for human monitoring.
    out.stderr.write(
      `error [${errJson.code}] ${errJson.message}\n`,
    );
  } else {
    // Human mode: stderr only; stdout stays empty.
    let msg = `Error: [${errJson.code}] ${errJson.message}`;
    if (errJson.requiredTier) {
      msg += `\nRequired tier: ${errJson.requiredTier}`;
    }
    if (errJson.retryAfterMs) {
      msg += `\nRetry after: ${errJson.retryAfterMs}ms`;
    }
    if (errJson.retryHint && errJson.retryHint.kind !== "never") {
      msg += `\nHint: ${errJson.retryHint.kind}`;
    }
    out.stderr.write(msg + "\n");
  }
}

/**
 * Render a non-CurviateError (unexpected/internal) to stderr.
 */
export function renderUnexpectedError(
  err: unknown,
  out: OutputStreams,
): void {
  const message =
    err instanceof Error ? err.message : "An unexpected error occurred.";
  out.stderr.write(`Internal error: ${message}\n`);
}
