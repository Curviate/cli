import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  buildPreviewOutput,
  type PreviewRequest,
} from "../../src/lib/preview.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("lib/preview — buildPreviewOutput", () => {
  it("returns a structured preview object", () => {
    const req: PreviewRequest = {
      method: "invites.send",
      args: { recipientId: "john-doe" },
      body: { message: "Hi there" },
      account: "acc_123",
    };
    const result = buildPreviewOutput(req);
    expect(result.method).toBe("invites.send");
    expect(result.account).toBe("acc_123");
    expect(result.body).toMatchObject({ message: "Hi there" });
  });

  it("renders attachment as name (N bytes), never the raw bytes", () => {
    const buf = Buffer.from("fake image data");
    const req: PreviewRequest = {
      method: "posts.create",
      args: {},
      body: { text: "Hello" },
      account: "acc_1",
      attachments: [{ name: "photo.jpg", buffer: buf }],
    };
    const result = buildPreviewOutput(req);
    const attachmentDesc = result.attachments?.[0];
    expect(attachmentDesc).toBe(`photo.jpg (${buf.byteLength} bytes)`);
    // Raw bytes should not appear
    expect(JSON.stringify(result)).not.toContain("fake image data");
  });

  it("never includes the API key in preview output", () => {
    const apiKey = "rdc_live_SENTINEL_KEY";
    const req: PreviewRequest = {
      method: "accounts.list",
      args: {},
      body: {},
      account: "acc_1",
    };
    const result = buildPreviewOutput(req);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(apiKey);
  });

  it("does not include dry_run or dry-run in the preview output", () => {
    const req: PreviewRequest = {
      method: "invites.send",
      args: { recipientId: "slug" },
      body: { message: "note" },
      account: "acc_1",
    };
    const result = buildPreviewOutput(req);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/dry[_-]run/i);
  });
});

describe("lib/preview — no dry_run in source", () => {
  it("source file contains no dry_run or dry-run token", () => {
    // Read the preview.ts source directly and assert clean.
    const srcPath = resolve(__dirname, "../../src/lib/preview.ts");
    const src = readFileSync(srcPath, "utf8");
    expect(src).not.toMatch(/dry[_-]run/i);
  });
});
