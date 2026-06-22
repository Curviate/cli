/**
 * Attachment loading for multipart write commands.
 *
 * Reads a file path to a Buffer. A missing or unreadable file produces a
 * usage error (exit 2) before any SDK call is made. The bytes are never
 * logged and never echoed; `--preview` renders attachments as
 * `<name> (N bytes)` via lib/preview.ts.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

/** A usage-error that the run-loop maps to exit 2. */
export class AttachError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "AttachError";
  }
}

/**
 * Read a file at `filePath` into a Buffer.
 *
 * @throws {AttachError} (exitCode 2) if the file is missing or unreadable.
 */
export async function readAttachment(filePath: string): Promise<Buffer> {
  try {
    const buf = await readFile(filePath);
    return buf;
  } catch (err: unknown) {
    const filename = basename(filePath);
    const reason =
      err instanceof Error ? err.message : "unknown error";
    throw new AttachError(
      `Cannot read attachment "${filename}": ${reason}. Pass a valid file path.`,
    );
  }
}

/**
 * Build a preview description for an attachment (name + byte length).
 * Bytes are never included in the preview output.
 */
export function describeAttachment(filePath: string, buf: Buffer): string {
  return `${basename(filePath)} (${buf.byteLength} bytes)`;
}
