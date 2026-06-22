/**
 * `--all` pagination streaming for the CLI.
 *
 * Wraps the SDK's `curviate.paginate()` pattern with a `--max-pages` guard
 * to prevent infinite loops. On truncation, a note is written to stderr and
 * the command exits 0 (not an error).
 *
 * Commands that are not paginated (no `items` or `data` array in the response)
 * reject `--all` with exit 2.
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

export interface StreamAllOptions {
  /** Maximum pages to fetch. Default 100. */
  maxPages?: number;
  /** Called with a human-readable message when streaming is truncated. */
  onTruncated?: (message: string) => void;
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
      const msg = `Streaming truncated at ${maxPages} page(s) — more results may exist. ` +
        `Increase --max-pages or use --cursor / --limit for manual paging.`;
      if (opts.onTruncated) {
        opts.onTruncated(msg);
      }
      break;
    }
  }
}
