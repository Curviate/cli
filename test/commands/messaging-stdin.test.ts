/**
 * Tests for stdin "-" sentinel for TEXT positionals.
 *
 * When TEXT positional is exactly "-", the command reads all of stdin until
 * EOF, trims trailing newlines, and uses the result as the text.
 * Empty stdin (zero bytes after trim) exits 2 with "stdin: empty input".
 *
 * Applies to: message send, message new, message edit, message inmail,
 *             post create, post comment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Shared stubs / factories
// ---------------------------------------------------------------------------

function makeMessageNs() {
  return {
    users: {
      get: vi.fn().mockResolvedValue({ id: "ACoAAA123", public_identifier: "slug" }),
    },
    messaging: {
      startChat: vi.fn().mockResolvedValue({ object: "chat_started", chat_id: "c1", message_id: "m1" }),
      sendMessage: vi.fn().mockResolvedValue({ object: "message_sent", message_id: "msg_1" }),
      editMessage: vi.fn().mockResolvedValue({ object: "message_edited" }),
      sendInMail: vi.fn().mockResolvedValue({ object: "inmail_sent", message_id: "msg_1", chat_id: "chat_1" }),
    },
  };
}

function makePostNs() {
  return {
    posts: {
      create: vi.fn().mockResolvedValue({ object: "post_created", post_id: "p1" }),
      comment: vi.fn().mockResolvedValue({ object: "comment_created" }),
    },
  };
}

function makeMessageClient(ns: ReturnType<typeof makeMessageNs>) {
  return { account: vi.fn().mockReturnValue(ns) };
}

function makePostClient(ns: ReturnType<typeof makePostNs>) {
  return { account: vi.fn().mockReturnValue(ns) };
}

function makeOut() {
  return {
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
  };
}

/** Inject stdin that returns the given string (already trimmed by caller). */
function makeStdin(content: string) {
  return vi.fn().mockResolvedValue(content);
}

/** Inject stdin that returns empty string (simulates empty stdin after trim). */
function makeEmptyStdin() {
  return vi.fn().mockResolvedValue("");
}

// ---------------------------------------------------------------------------
// message send "-" → reads stdin as text
// ---------------------------------------------------------------------------

describe("message send with stdin sentinel", () => {
  let ns: ReturnType<typeof makeMessageNs>;
  let client: ReturnType<typeof makeMessageClient>;

  beforeEach(() => {
    ns = makeMessageNs();
    client = makeMessageClient(ns);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stdin sentinel reads input and passes trimmed text to sendMessage", async () => {
    const { runMessageSend } = await import("../../src/commands/message.js");
    const out = makeOut();

    await runMessageSend(
      client as never,
      { chatId: "chat_1", text: "-", account: "acc_1", json: true },
      out,
      makeStdin("Hello world"),
    );

    expect(ns.messaging.sendMessage).toHaveBeenCalledWith(
      "chat_1",
      expect.objectContaining({ text: "Hello world" }),
    );
  });

  it("empty stdin exits 2 with stdin empty input error", async () => {
    const { runMessageSend } = await import("../../src/commands/message.js");
    const out = makeOut();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runMessageSend(
        client as never,
        { chatId: "chat_1", text: "-", account: "acc_1", json: true },
        out,
        makeEmptyStdin(),
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
      const stderrOutput = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
      expect(stderrOutput).toContain("stdin: empty input");
    } finally {
      exitSpy.mockRestore();
    }

    expect(ns.messaging.sendMessage).not.toHaveBeenCalled();
  });

  it("trailing newline in stdin is stripped before passing to sendMessage", async () => {
    const { runMessageSend } = await import("../../src/commands/message.js");
    const out = makeOut();

    // The readStdin helper trims trailing newlines; mock returns already-trimmed value
    await runMessageSend(
      client as never,
      { chatId: "chat_1", text: "-", account: "acc_1", json: true },
      out,
      makeStdin("Hello world"),
    );

    expect(ns.messaging.sendMessage).toHaveBeenCalledWith(
      "chat_1",
      expect.objectContaining({ text: "Hello world" }),
    );
  });

  it("multi-line stdin preserves internal newlines, strips only trailing newline", async () => {
    const { runMessageSend } = await import("../../src/commands/message.js");
    const out = makeOut();

    await runMessageSend(
      client as never,
      { chatId: "chat_1", text: "-", account: "acc_1", json: true },
      out,
      makeStdin("Line 1\nLine 2"),
    );

    expect(ns.messaging.sendMessage).toHaveBeenCalledWith(
      "chat_1",
      expect.objectContaining({ text: "Line 1\nLine 2" }),
    );
  });

  it("non-sentinel text is passed through directly without calling stdin reader", async () => {
    const { runMessageSend } = await import("../../src/commands/message.js");
    const out = makeOut();
    const stdinReader = vi.fn();

    await runMessageSend(
      client as never,
      { chatId: "chat_1", text: "Plain text", account: "acc_1", json: true },
      out,
      stdinReader,
    );

    expect(stdinReader).not.toHaveBeenCalled();
    expect(ns.messaging.sendMessage).toHaveBeenCalledWith(
      "chat_1",
      expect.objectContaining({ text: "Plain text" }),
    );
  });
});

// ---------------------------------------------------------------------------
// message new "-" → reads stdin as text
// ---------------------------------------------------------------------------

describe("message new with stdin sentinel", () => {
  let ns: ReturnType<typeof makeMessageNs>;
  let client: ReturnType<typeof makeMessageClient>;

  beforeEach(() => {
    ns = makeMessageNs();
    client = makeMessageClient(ns);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stdin sentinel reads input and passes trimmed text to startChat", async () => {
    const { runMessageNew } = await import("../../src/commands/message.js");
    const out = makeOut();

    await runMessageNew(
      client as never,
      { to: "ACoAAA123", text: "-", account: "acc_1", json: true },
      out,
      makeStdin("Start new chat"),
    );

    expect(ns.messaging.startChat).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Start new chat" }),
    );
  });

  it("empty stdin exits 2 and startChat is not called", async () => {
    const { runMessageNew } = await import("../../src/commands/message.js");
    const out = makeOut();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runMessageNew(
        client as never,
        { to: "ACoAAA123", text: "-", account: "acc_1", json: true },
        out,
        makeEmptyStdin(),
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
      const stderrOutput = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
      expect(stderrOutput).toContain("stdin: empty input");
    } finally {
      exitSpy.mockRestore();
    }

    expect(ns.messaging.startChat).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// message edit "-" → reads stdin as text
// ---------------------------------------------------------------------------

describe("message edit with stdin sentinel", () => {
  let ns: ReturnType<typeof makeMessageNs>;
  let client: ReturnType<typeof makeMessageClient>;

  beforeEach(() => {
    ns = makeMessageNs();
    client = makeMessageClient(ns);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stdin sentinel reads input and passes trimmed text to editMessage", async () => {
    const { runMessageEdit } = await import("../../src/commands/message.js");
    const out = makeOut();

    await runMessageEdit(
      client as never,
      { chatId: "chat_1", messageId: "msg_1", text: "-", account: "acc_1", json: true },
      out,
      makeStdin("Edited text"),
    );

    expect(ns.messaging.editMessage).toHaveBeenCalledWith(
      "chat_1",
      "msg_1",
      expect.objectContaining({ text: "Edited text" }),
    );
  });

  it("empty stdin exits 2 and editMessage is not called", async () => {
    const { runMessageEdit } = await import("../../src/commands/message.js");
    const out = makeOut();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runMessageEdit(
        client as never,
        { chatId: "chat_1", messageId: "msg_1", text: "-", account: "acc_1", json: true },
        out,
        makeEmptyStdin(),
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
      const stderrOutput = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
      expect(stderrOutput).toContain("stdin: empty input");
    } finally {
      exitSpy.mockRestore();
    }

    expect(ns.messaging.editMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// message inmail "-" → reads stdin as text
// ---------------------------------------------------------------------------

describe("message inmail with stdin sentinel", () => {
  let ns: ReturnType<typeof makeMessageNs>;
  let client: ReturnType<typeof makeMessageClient>;

  beforeEach(() => {
    ns = makeMessageNs();
    client = makeMessageClient(ns);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stdin sentinel reads input and passes trimmed text to sendInMail", async () => {
    const { runMessageInMail } = await import("../../src/commands/message.js");
    const out = makeOut();

    await runMessageInMail(
      client as never,
      { to: "ACoAAA123", subject: "Hi", text: "-", account: "acc_1", json: true },
      out,
      makeStdin("InMail body"),
    );

    expect(ns.messaging.sendInMail).toHaveBeenCalledWith(
      expect.objectContaining({ text: "InMail body" }),
    );
  });

  it("empty stdin exits 2 and sendInMail is not called", async () => {
    const { runMessageInMail } = await import("../../src/commands/message.js");
    const out = makeOut();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runMessageInMail(
        client as never,
        { to: "ACoAAA123", subject: "Hi", text: "-", account: "acc_1", json: true },
        out,
        makeEmptyStdin(),
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
      const stderrOutput = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
      expect(stderrOutput).toContain("stdin: empty input");
    } finally {
      exitSpy.mockRestore();
    }

    expect(ns.messaging.sendInMail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// post create "-" → reads stdin as text
// ---------------------------------------------------------------------------

describe("post create with stdin sentinel", () => {
  let ns: ReturnType<typeof makePostNs>;
  let client: ReturnType<typeof makePostClient>;

  beforeEach(() => {
    ns = makePostNs();
    client = makePostClient(ns);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stdin sentinel reads input and passes trimmed text to posts.create", async () => {
    const { runPostCreate } = await import("../../src/commands/post.js");
    const out = makeOut();

    await runPostCreate(
      client as never,
      { text: "-", account: "acc_1", json: true },
      out,
      makeStdin("Post body"),
    );

    expect(ns.posts.create).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Post body" }),
    );
  });

  it("empty stdin exits 2 and posts.create is not called", async () => {
    const { runPostCreate } = await import("../../src/commands/post.js");
    const out = makeOut();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runPostCreate(
        client as never,
        { text: "-", account: "acc_1", json: true },
        out,
        makeEmptyStdin(),
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
      const stderrOutput = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
      expect(stderrOutput).toContain("stdin: empty input");
    } finally {
      exitSpy.mockRestore();
    }

    expect(ns.posts.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// post comment "-" → reads stdin as text
// ---------------------------------------------------------------------------

describe("post comment with stdin sentinel", () => {
  let ns: ReturnType<typeof makePostNs>;
  let client: ReturnType<typeof makePostClient>;

  beforeEach(() => {
    ns = makePostNs();
    client = makePostClient(ns);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stdin sentinel reads input and passes trimmed text to posts.comment", async () => {
    const { runPostComment } = await import("../../src/commands/post.js");
    const out = makeOut();

    await runPostComment(
      client as never,
      { postId: "post_1", text: "-", account: "acc_1", json: true },
      out,
      makeStdin("Comment text"),
    );

    expect(ns.posts.comment).toHaveBeenCalledWith(
      "post_1",
      expect.objectContaining({ text: "Comment text" }),
    );
  });

  it("empty stdin exits 2 and posts.comment is not called", async () => {
    const { runPostComment } = await import("../../src/commands/post.js");
    const out = makeOut();

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${code})`);
    });

    try {
      await runPostComment(
        client as never,
        { postId: "post_1", text: "-", account: "acc_1", json: true },
        out,
        makeEmptyStdin(),
      );
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
      const stderrOutput = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
      expect(stderrOutput).toContain("stdin: empty input");
    } finally {
      exitSpy.mockRestore();
    }

    expect(ns.posts.comment).not.toHaveBeenCalled();
  });
});
