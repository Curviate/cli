/**
 * `--all` pagination streaming for the CLI.
 *
 * Wraps the SDK's `curviate.paginate()` pattern with a `--max-pages` guard
 * to prevent infinite loops. On truncation, the command exits 0 (not an
 * error).
 *
 * Commands that are not paginated (no `items` or `data` array in the response)
 * reject `--all` with exit 2.
 *
 * **Truncation output contract.** When `--max-pages` truncates a stream that
 * still has pages remaining, EVERY `--all` command must emit the identical
 * two-channel sentinel:
 *   - stdout (data channel, last NDJSON line): a machine-readable JSON object
 *     `{"object":"stream_truncated","pages_fetched":<n>,"has_more":true}`.
 *   - stderr (diagnostics channel): a human-readable prose note.
 * A command that exhausts naturally (cursor null) writes neither line.
 *
 * This is enforced HERE, not at each call site: pass `out` (the command's
 * stdout/stderr pair) via `StreamAllOptions` and `streamAll` writes both
 * lines itself on truncation. Call sites must not hand-roll either write —
 * that per-call-site duplication is exactly what previously let most `--all`
 * commands drop the stdout sentinel while the search commands independently
 * dropped the stderr note. `onTruncated` remains as an optional additional
 * hook (fires alongside `out`, or standalone if `out` is omitted) for
 * callers/tests that need to observe truncation beyond the standard output
 * contract.
 */

/** Usage error for non-paginated commands. */
export class PaginateError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "PaginateError";
  }
}

type PageResponse = {
  items?: unknown[];
  data?: unknown[];
  cursor?: string | null;
};

type PaginatableMethod<P extends Record<string, unknown>> = (
  params: P,
) => Promise<PageResponse>;

/**
 * Minimal writable-stream pair — structurally compatible with every
 * command's local `OutputStreams` type (and `lib/output.ts`'s exported one).
 */
export interface StreamWriters {
  stdout: { write: (s: string) => void };
  stderr: { write: (s: string) => void };
}

/** The canonical --all truncation prose note, shared so no call site re-authors its own wording. */
export function truncationProseNote(pagesFetched: number): string {
  return `Streaming truncated at ${pagesFetched} page(s). Use --all --max-pages or --cursor for manual paging.\n`;
}

/** The canonical --all truncation JSON sentinel line, including the trailing newline. */
export function truncationSentinelLine(pagesFetched: number, hasMore: boolean): string {
  return JSON.stringify({ object: "stream_truncated", pages_fetched: pagesFetched, has_more: hasMore }) + "\n";
}

export interface StreamAllOptions {
  /** Maximum pages to fetch. Default 100. */
  maxPages?: number;
  /**
   * The command's output streams. When provided, `streamAll` writes the
   * truncation contract itself on truncation: the JSON sentinel to
   * `out.stdout` followed by the prose note to `out.stderr`. This is the
   * single source of truth — do not also write these at the call site.
   */
  out?: StreamWriters;
  /**
   * Optional hook invoked on truncation with (pagesFetched, hasMore), in
   * addition to (or, if `out` is omitted, instead of) the standard output
   * contract above. Escape hatch for callers/tests that need to observe
   * truncation directly.
   */
  onTruncated?: (pagesFetched: number, hasMore: boolean) => void;
}

/**
 * Stream all items from a paginated SDK method as an async iterable.
 *
 * Fetches pages, injecting the cursor from each response into the next call.
 * Yields individual items. Stops when cursor is null or maxPages is reached.
 *
 * @throws {PaginateError} (exitCode 2) when the first response has no items/data array.
 */
export async function* streamAll<P extends Record<string, unknown>>(
  fn: PaginatableMethod<P>,
  params: P,
  opts: StreamAllOptions = {},
): AsyncGenerator<unknown> {
  const maxPages = opts.maxPages ?? 100;
  let cursor: string | undefined | null = undefined;
  let pageCount = 0;
  let firstPage = true;

  while (true) {
    const pageParams: P =
      cursor !== undefined && cursor !== null
        ? ({ ...params, cursor } as P)
        : params;

    const page = await fn(pageParams);
    pageCount++;

    // Validate paginatable shape on first response.
    const items = page.items ?? page.data;
    if (firstPage && !Array.isArray(items)) {
      throw new PaginateError(
        "--all requires a paginated method (response must have `items` or `data` array). " +
        "Remove --all for non-list commands.",
      );
    }
    firstPage = false;

    if (Array.isArray(items)) {
      for (const item of items) {
        yield item;
      }
    }

    // Advance cursor.
    cursor = page.cursor;

    // Stop conditions.
    if (!cursor) break;

    if (pageCount >= maxPages) {
      const hasMore = cursor !== null && cursor !== undefined;
      if (opts.out) {
        opts.out.stdout.write(truncationSentinelLine(pageCount, hasMore));
        opts.out.stderr.write(truncationProseNote(pageCount));
      }
      if (opts.onTruncated) {
        opts.onTruncated(pageCount, hasMore);
      }
      break;
    }
  }
}
