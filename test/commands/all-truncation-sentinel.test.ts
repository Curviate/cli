/**
 * Sweep test for the --all truncation output contract: the machine-readable
 * JSON sentinel on stdout and the human-readable prose note on stderr must
 * be identical on every --all-capable command, not just search.
 *
 * Two layers:
 *
 * 1. Structural regression guard — greps every command source file for the
 *    truncation sentinel/prose literals. After the fix, those strings must
 *    live ONLY in lib/paginate.ts (the single shared implementation). If a
 *    future change re-introduces a hand-rolled write at a call site, this
 *    fails immediately without needing per-command functional mocks.
 *
 * 2. Functional table — drives one representative --all command per command
 *    file (12 files: account, comment, company, connect, inbox, job, post,
 *    profile, recruiter, sales-nav, webhook, plus search covered exhaustively
 *    in search.test.ts) through a real page-cap truncation and asserts BOTH
 *    channels: the exact three-key JSON sentinel as the last stdout line,
 *    and a truncation-shaped note on stderr.
 */

import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const commandsDir = resolve(__dirname, "../../src/commands");

function makeOut() {
  return { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
}

/** Parses stdout writes into lines and returns the ones that look like JSON objects. */
function jsonLines(out: ReturnType<typeof makeOut>): unknown[] {
  return (out.stdout.write as Mock).mock.calls
    .map((c) => (c[0] as string).trim())
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as unknown);
}

function stderrText(out: ReturnType<typeof makeOut>): string {
  return (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
}

const SENTINEL_SHAPE = { object: "stream_truncated", pages_fetched: 1, has_more: true };

// ---------------------------------------------------------------------------
// 1. Structural regression guard
// ---------------------------------------------------------------------------

describe("--all truncation contract — structural regression guard", () => {
  it("the sentinel JSON and the prose note live ONLY in lib/paginate.ts, never hand-rolled at a command call site", async () => {
    const files = (await readdir(commandsDir)).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(join(commandsDir, file), "utf8");
      if (content.includes("stream_truncated")) {
        offenders.push(`${file}: hand-rolls the "stream_truncated" sentinel instead of delegating to lib/paginate.ts`);
      }
      if (content.includes("Streaming truncated at")) {
        offenders.push(`${file}: hand-rolls the truncation prose note instead of delegating to lib/paginate.ts`);
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  it("every streamAll(...) call site passes `out` (no lingering hand-rolled onTruncated writer)", async () => {
    const files = (await readdir(commandsDir)).filter((f) => f.endsWith(".ts"));
    const offenders: string[] = [];

    for (const file of files) {
      const content = await readFile(join(commandsDir, file), "utf8");
      const matches = [...content.matchAll(/streamAll\(/g)];
      for (const m of matches) {
        // Look at the next ~200 chars after the call — the options block is
        // small (maxPages + out, at most a couple of lines).
        const window = content.slice(m.index, m.index + 200);
        if (!/\bout\b/.test(window)) {
          offenders.push(`${file} near offset ${m.index}: streamAll(...) call site has no \`out\` in its options`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Functional table — one representative --all command per command file
// ---------------------------------------------------------------------------

describe("--all truncation contract — functional sweep (one command per file)", () => {
  it("account list --all --max-pages 1", async () => {
    const { runAccountList } = await import("../../src/commands/account.js");
    const client = { accounts: { list: vi.fn() } };
    (client.accounts.list as Mock)
      .mockResolvedValueOnce({ items: [{ account_id: "acc_1" }], cursor: "c1" });
    const out = makeOut();

    await runAccountList(client as never, { all: true, "max-pages": "1" } as never, out);

    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("comment list <post_id> --all --max-pages 1", async () => {
    const { runCommentList } = await import("../../src/commands/comment.js");
    const accountNs = { posts: { listComments: vi.fn() } };
    const client = { account: vi.fn().mockReturnValue(accountNs) };
    (accountNs.posts.listComments as Mock)
      .mockResolvedValueOnce({ items: [{ id: "cm_1" }], cursor: "c1" });
    const out = makeOut();

    await runCommentList(client as never, { postId: "p1", account: "acc_1", all: true, "max-pages": "1" } as never, out);

    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("company employees <id> --all --max-pages 1", async () => {
    const { runCompanyEmployees } = await import("../../src/commands/company.js");
    const accountNs = { companies: { employees: vi.fn() } };
    const client = { account: vi.fn().mockReturnValue(accountNs) };
    (accountNs.companies.employees as Mock)
      .mockResolvedValueOnce({ items: [{ id: "u1" }], cursor: "c1" });
    const out = makeOut();

    // Numeric id skips the slug->id resolve call — isolates the truncation path.
    await runCompanyEmployees(client as never, { id: "112013061", account: "acc_1", all: true, "max-pages": "1" } as never, out);

    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("connect sent --all --max-pages 1", async () => {
    const { runConnectSent } = await import("../../src/commands/connect.js");
    const accountNs = { invites: { listSent: vi.fn() } };
    const client = { account: vi.fn().mockReturnValue(accountNs) };
    (accountNs.invites.listSent as Mock)
      .mockResolvedValueOnce({ items: [{ id: "inv_1" }], cursor: "c1" });
    const out = makeOut();

    await runConnectSent(client as never, { account: "acc_1", all: true, "max-pages": "1" } as never, out);

    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("inbox list --all --max-pages 1", async () => {
    const { runInboxList } = await import("../../src/commands/inbox.js");
    const accountNs = { messaging: { listChats: vi.fn() } };
    const client = { account: vi.fn().mockReturnValue(accountNs) };
    (accountNs.messaging.listChats as Mock)
      .mockResolvedValueOnce({ items: [{ id: "chat_1" }], cursor: "c1" });
    const out = makeOut();

    await runInboxList(client as never, { account: "acc_1", all: true, "max-pages": "1" } as never, out);

    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("job list --state OPEN --all --max-pages 1 (the M3-cited command family)", async () => {
    const { runJobList } = await import("../../src/commands/job.js");
    const accountNs = { jobs: { list: vi.fn() } };
    const client = { account: vi.fn().mockReturnValue(accountNs) };
    (accountNs.jobs.list as Mock)
      .mockResolvedValueOnce({ items: [{ id: "job_1" }], cursor: "c1" });
    const out = makeOut();

    await runJobList(client as never, { state: "OPEN", account: "acc_1", all: true, "max-pages": "1" } as never, out);

    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("post user-posts <user_id> --all --max-pages 1 — the exact M3 evidence command", async () => {
    const { runPostUserPosts } = await import("../../src/commands/post.js");
    const accountNs = { posts: { listUserPosts: vi.fn() }, users: { get: vi.fn() } };
    const client = { account: vi.fn().mockReturnValue(accountNs) };
    (accountNs.posts.listUserPosts as Mock)
      .mockResolvedValueOnce({ items: [{ id: "post_1" }], cursor: "c1" });
    const out = makeOut();

    // userId "me" passes straight through — zero extra resolve calls.
    await runPostUserPosts(client as never, { userId: "me", account: "acc_1", all: true, "max-pages": "1" } as never, out);

    expect(accountNs.users.get).not.toHaveBeenCalled();
    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("profile me --posts --all --max-pages 1 (self-scoped activity branch, distinct code path from profile relations)", async () => {
    const { runProfileMe } = await import("../../src/commands/profile.js");
    const accountNs = { posts: { listUserPosts: vi.fn() } };
    const client = { account: vi.fn().mockReturnValue(accountNs) };
    (accountNs.posts.listUserPosts as Mock)
      .mockResolvedValueOnce({ items: [{ id: "post_1" }], cursor: "c1" });
    const out = makeOut();

    await runProfileMe(client as never, { posts: true, account: "acc_1", all: true, "max-pages": "1" } as never, out);

    expect(accountNs.posts.listUserPosts).toHaveBeenCalledWith("me", expect.anything());
    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("recruiter projects --all --max-pages 1", async () => {
    const { runRecruiterListProjects } = await import("../../src/commands/recruiter.js");
    const accountNs = { recruiter: { listProjects: vi.fn() } };
    const client = { account: vi.fn().mockReturnValue(accountNs) };
    (accountNs.recruiter.listProjects as Mock)
      .mockResolvedValueOnce({ items: [{ id: "proj_1" }], cursor: "c1" });
    const out = makeOut();

    await runRecruiterListProjects(client as never, { account: "acc_1", all: true, "max-pages": "1" } as never, out);

    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("sales-nav account-lists --all --max-pages 1", async () => {
    const { runSalesNavAccountLists } = await import("../../src/commands/sales-nav.js");
    const accountNs = { salesNavigator: { accountLists: vi.fn() } };
    const client = { account: vi.fn().mockReturnValue(accountNs) };
    (accountNs.salesNavigator.accountLists as Mock)
      .mockResolvedValueOnce({ items: [{ id: "list_1" }], cursor: "c1" });
    const out = makeOut();

    await runSalesNavAccountLists(client as never, { account: "acc_1", all: true, "max-pages": "1" } as never, out);

    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  it("webhook list --all --max-pages 1", async () => {
    const { runWebhookList } = await import("../../src/commands/webhook.js");
    const client = { webhooks: { list: vi.fn() } };
    (client.webhooks.list as Mock)
      .mockResolvedValueOnce({ items: [{ id: "wh_1" }], cursor: "c1" });
    const out = makeOut();

    await runWebhookList(client as never, { all: true, "max-pages": "1" } as never, out);

    const lines = jsonLines(out);
    expect(lines[lines.length - 1]).toEqual(SENTINEL_SHAPE);
    expect(stderrText(out)).toMatch(/truncat/i);
  });

  // search.ts's four entity commands (people/companies/posts/jobs) get their
  // own dedicated, exhaustive coverage in test/commands/search.test.ts —
  // including the natural-exhaustion negative case — since search was the
  // command family with the *inverse* half of this defect (stdout sentinel
  // present, stderr prose missing). Not duplicated here.
});
