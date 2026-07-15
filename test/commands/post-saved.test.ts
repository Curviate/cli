/**
 * Tests for the saved-posts extension of the `post` noun:
 *   post saved            → posts.listSaved  (read, paginated)
 *   post save <post_id>   → posts.save       (write, --preview)
 *   post unsave <post_id> → posts.unsave     (write, --preview)
 *
 * The SDK boundary is stubbed. `saved` rejects --preview; the two writes are
 * --preview-capable and pass post_id verbatim.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

function makeNs() {
  return { posts: { listSaved: vi.fn(), save: vi.fn(), unsave: vi.fn() } };
}
function makeClient(ns: ReturnType<typeof makeNs>) {
  return { account: vi.fn().mockReturnValue(ns) };
}
function makeOut() {
  return { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
}
function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}
function stdout(out: ReturnType<typeof makeOut>): string {
  return (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
}
type Flags = Record<string, unknown>;

describe("post saved", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.posts.listSaved as Mock).mockResolvedValue({ object: "saved_post_list", items: [{ post_id: "urn:li:activity:1", snippet: "preview…" }], cursor: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists own saved posts (self resource, no target), forwards limit", async () => {
    const { runPostSaved } = await import("../../src/commands/post.js");
    const out = makeOut();
    await runPostSaved(client as never, { account: "acc_1", json: true, limit: "5" } as Flags, out);
    expect(ns.posts.listSaved).toHaveBeenCalledWith({ limit: 5 });
    expect((JSON.parse(stdout(out)) as { items: unknown[] }).items).toHaveLength(1);
  });

  it("--preview → exit 2 (read command)", async () => {
    const { runPostSaved } = await import("../../src/commands/post.js");
    const out = makeOut();
    const exit = mockExit();
    try {
      await runPostSaved(client as never, { account: "acc_1", preview: true } as Flags, out);
      expect.fail("should exit");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exit.mockRestore();
    }
    expect(ns.posts.listSaved).not.toHaveBeenCalled();
  });

  it("--all streams pages, walking the cursor", async () => {
    (ns.posts.listSaved as Mock)
      .mockResolvedValueOnce({ object: "saved_post_list", items: [{ post_id: "1" }], cursor: "c1" })
      .mockResolvedValueOnce({ object: "saved_post_list", items: [{ post_id: "2" }], cursor: null });
    const { runPostSaved } = await import("../../src/commands/post.js");
    const out = makeOut();
    await runPostSaved(client as never, { account: "acc_1", json: true, all: true, "page-delay": "0" } as Flags, out);
    const lines = stdout(out).trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(ns.posts.listSaved).toHaveBeenNthCalledWith(2, { cursor: "c1" });
  });
});

describe("post save", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.posts.save as Mock).mockResolvedValue({ object: "saved_post", saved: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("passes post_id verbatim and prints the result", async () => {
    const { runPostSave } = await import("../../src/commands/post.js");
    const out = makeOut();
    await runPostSave(client as never, { account: "acc_1", json: true, postId: "urn:li:activity:1" } as Flags, out);
    expect(ns.posts.save).toHaveBeenCalledWith("urn:li:activity:1");
    expect((JSON.parse(stdout(out)) as { saved: boolean }).saved).toBe(true);
  });

  it("--preview renders posts.save WITHOUT sending", async () => {
    const { runPostSave } = await import("../../src/commands/post.js");
    const out = makeOut();
    await runPostSave(client as never, { account: "acc_1", json: true, postId: "12345", preview: true } as Flags, out);
    expect(ns.posts.save).not.toHaveBeenCalled();
    const preview = JSON.parse(stdout(out)) as { method: string; args: Record<string, unknown> };
    expect(preview.method).toBe("posts.save");
    expect(preview.args["post_id"]).toBe("12345");
  });
});

describe("post unsave", () => {
  let ns: ReturnType<typeof makeNs>;
  let client: ReturnType<typeof makeClient>;
  beforeEach(() => {
    ns = makeNs();
    client = makeClient(ns);
    (ns.posts.unsave as Mock).mockResolvedValue({ object: "saved_post", saved: false });
  });
  afterEach(() => vi.restoreAllMocks());

  it("passes post_id verbatim and prints the result", async () => {
    const { runPostUnsave } = await import("../../src/commands/post.js");
    const out = makeOut();
    await runPostUnsave(client as never, { account: "acc_1", json: true, postId: "12345" } as Flags, out);
    expect(ns.posts.unsave).toHaveBeenCalledWith("12345");
    expect((JSON.parse(stdout(out)) as { saved: boolean }).saved).toBe(false);
  });

  it("--preview renders posts.unsave WITHOUT sending", async () => {
    const { runPostUnsave } = await import("../../src/commands/post.js");
    const out = makeOut();
    await runPostUnsave(client as never, { account: "acc_1", json: true, postId: "12345", preview: true } as Flags, out);
    expect(ns.posts.unsave).not.toHaveBeenCalled();
    const preview = JSON.parse(stdout(out)) as { method: string };
    expect(preview.method).toBe("posts.unsave");
  });
});
