import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAttachment, toAttachmentPayload, guessContentType } from "../../src/lib/attach.js";

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

describe("lib/attach — guessContentType", () => {
  it.each([
    ["photo.png", "image/png"],
    ["photo.JPG", "image/jpeg"],
    ["clip.mp4", "video/mp4"],
    ["memo.pdf", "application/pdf"],
    ["note.txt", "application/octet-stream"],
    ["no-extension", "application/octet-stream"],
  ])("maps %s -> %s", (filename, expected) => {
    expect(guessContentType(filename)).toBe(expected);
  });
});

describe("lib/attach — toAttachmentPayload", () => {
  it("base64-encodes the buffer and derives filename + content_type", () => {
    const buf = Buffer.from("hello world");
    const payload = toAttachmentPayload("/tmp/some/dir/hello.png", buf);
    expect(payload).toEqual({
      content: buf.toString("base64"),
      content_type: "image/png",
      filename: "hello.png",
    });
  });

  it("round-trips: decoding content yields the original bytes", () => {
    const buf = Buffer.from([0, 1, 2, 255, 254]);
    const payload = toAttachmentPayload("bytes.bin", buf);
    expect(Buffer.from(payload.content, "base64")).toEqual(buf);
  });

  it("falls back to application/octet-stream for an unknown extension", () => {
    const payload = toAttachmentPayload("data.xyz", Buffer.from("x"));
    expect(payload.content_type).toBe("application/octet-stream");
  });
});
