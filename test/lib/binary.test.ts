import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeBinaryOutput, BinaryOutputError } from "../../src/lib/binary.js";
import { PassThrough } from "node:stream";

describe("lib/binary — writeBinaryOutput", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "curviate-test-binary-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes to a file when -o is given", async () => {
    const outPath = join(tmpDir, "out.bin");
    const data = Buffer.from([1, 2, 3, 4]);
    const stdout = new PassThrough();
    await writeBinaryOutput(data, { outputPath: outPath, isTTY: false, stdout });
    const written = await readFile(outPath);
    expect(Buffer.compare(written, data)).toBe(0);
  });

  it("writes to stdout when non-TTY and no -o", async () => {
    const data = Buffer.from([10, 20, 30]);
    const stdout = new PassThrough();
    const chunks: Buffer[] = [];
    stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    await writeBinaryOutput(data, { outputPath: undefined, isTTY: false, stdout });

    const received = Buffer.concat(chunks);
    expect(Buffer.compare(received, data)).toBe(0);
  });

  it("throws BinaryOutputError (exitCode 2) when TTY and no -o", async () => {
    const data = Buffer.from([1]);
    const stdout = new PassThrough();
    await expect(
      writeBinaryOutput(data, { outputPath: undefined, isTTY: true, stdout }),
    ).rejects.toBeInstanceOf(BinaryOutputError);
  });

  it("BinaryOutputError has exitCode 2", async () => {
    const data = Buffer.from([1]);
    const stdout = new PassThrough();
    try {
      await writeBinaryOutput(data, { outputPath: undefined, isTTY: true, stdout });
      expect.fail("should have thrown");
    } catch (err: unknown) {
      expect((err as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("accepts ArrayBuffer input", async () => {
    const outPath = join(tmpDir, "ab.bin");
    const ab = new Uint8Array([5, 6, 7]).buffer;
    const stdout = new PassThrough();
    await writeBinaryOutput(ab, { outputPath: outPath, isTTY: false, stdout });
    const written = await readFile(outPath);
    expect(Array.from(written)).toEqual([5, 6, 7]);
  });
});
