import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAttachment } from "../../src/lib/attach.js";

describe("lib/attach — readAttachment", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "curviate-test-attach-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads a file and returns a Buffer", async () => {
    const filePath = join(tmpDir, "test.txt");
    await writeFile(filePath, "hello world");
    const buf = await readAttachment(filePath);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.toString()).toBe("hello world");
  });

  it("is repeatable — reading same file twice gives same result", async () => {
    const filePath = join(tmpDir, "repeat.txt");
    await writeFile(filePath, "data");
    const buf1 = await readAttachment(filePath);
    const buf2 = await readAttachment(filePath);
    expect(buf1.toString()).toBe(buf2.toString());
  });

  it("throws with exit code 2 on missing file", async () => {
    const missingPath = join(tmpDir, "does-not-exist.txt");
    await expect(readAttachment(missingPath)).rejects.toThrow();
  });

  it("thrown error has exitCode 2", async () => {
    const missingPath = join(tmpDir, "no-file.txt");
    try {
      await readAttachment(missingPath);
      expect.fail("should have thrown");
    } catch (err: unknown) {
      expect((err as { exitCode?: number }).exitCode).toBe(2);
    }
  });
});
