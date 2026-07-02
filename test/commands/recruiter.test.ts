/**
 * Tests for the `recruiter` command group.
 *
 * Coverage:
 *   recruiter sync                                                              → recruiter.syncMessages
 *   recruiter message new --to <id> "<text>" [--attach…] [--voice] [--video]  → recruiter.startChat (multipart)
 *   recruiter profile <identifier>                                              → recruiter.getProfile (resolveIdentifier)
 *   recruiter search people [filters…]                                         → recruiter.searchPeople (POST)
 *   recruiter search parameters --type <t>                                     → recruiter.getParameters (GET)
 *   recruiter projects [--all] [--limit] [--cursor]                            → recruiter.listProjects
 *   recruiter project <project_id>                                             → recruiter.getProject (verbatim id)
 *   recruiter add-candidate <user_id> --hiring-project-id <id>                → recruiter.addCandidate
 *   recruiter add-applicant <user_id> --hiring-project-id <id>                → recruiter.addApplicant
 *   recruiter reject-applicant <user_id> --hiring-project-id <id> --reason <r>→ recruiter.rejectApplicant
 *   recruiter jobs [--all] [--limit] [--cursor]                                → recruiter.listJobs
 *   recruiter job create <body…>                                               → recruiter.createJob
 *   recruiter job publish <job_id>                                             → recruiter.publishJob
 *   recruiter job checkpoint <job_id> --input <v>                              → recruiter.solveJobCheckpoint
 *   recruiter job applicants <job_id>                                          → recruiter.listApplicants
 *   recruiter applicant <applicant_id>                                         → recruiter.getApplicant (verbatim id)
 *   recruiter applicant resume <applicant_id> -o <file>                        → recruiter.downloadResume (binary)
 *
 * Tier gate:
 *   TIER_NOT_ACTIVE → exit 5 + JSON requiredTier
 *   LINKEDIN_FEATURE_NOT_SUBSCRIBED → exit 5 + JSON code
 *
 * --preview on writes: renders preview, no SDK call.
 * --preview on reads: exit 2.
 * resolveIdentifier applied to `profile <identifier>` only.
 * user_id / job_id / applicant_id / project_id pass verbatim.
 * Resume binary: -o writes file; TTY without -o exits 2.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { writeFile, mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Mock client factory ───────────────────────────────────────────────────

function makeRecruiterNs() {
  return {
    recruiter: {
      syncMessages: vi.fn(),
      startChat: vi.fn(),
      getProfile: vi.fn(),
      searchPeople: vi.fn(),
      getParameters: vi.fn(),
      listProjects: vi.fn(),
      getProject: vi.fn(),
      addCandidate: vi.fn(),
      addApplicant: vi.fn(),
      rejectApplicant: vi.fn(),
      listJobs: vi.fn(),
      createJob: vi.fn(),
      publishJob: vi.fn(),
      solveJobCheckpoint: vi.fn(),
      listApplicants: vi.fn(),
      getApplicant: vi.fn(),
      downloadResume: vi.fn(),
    },
  };
}

function makeClient(ns: ReturnType<typeof makeRecruiterNs>) {
  return {
    account: vi.fn().mockReturnValue(ns),
  };
}


// ─── Shared helpers ────────────────────────────────────────────────────────

function makeOut() {
  return {
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
  };
}

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code})`);
  });
}

function makeTierError(code: string, requiredTier?: string) {
  return Object.assign(new Error(`Tier error: ${code}`), {
    code,
    requiredTier,
    userFixable: true,
    retryLikelyToSucceed: false,
    toJSON: () => ({ code, requiredTier, message: `Tier error: ${code}` }),
  });
}

// ─── Tier gate tests ───────────────────────────────────────────────────────

describe("recruiter tier gate", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recruiter projects — TIER_NOT_ACTIVE → exit 5, requiredTier:recruiter", async () => {
    const tierErr = makeTierError("TIER_NOT_ACTIVE", "recruiter");
    (ns.recruiter.listProjects as Mock).mockRejectedValue(tierErr);

    const { CurviateError } = await import("@curviate/sdk");
    Object.setPrototypeOf(tierErr, CurviateError.prototype);

    const { runRecruiterListProjects } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterListProjects(client as never, { account: "acc_1", json: true }, out);
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(5)");
    } finally {
      exitSpy.mockRestore();
    }

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.error.code).toBe("TIER_NOT_ACTIVE");
    expect(parsed.error.requiredTier).toBe("recruiter");
  });

  it("recruiter search people — LINKEDIN_FEATURE_NOT_SUBSCRIBED → exit 5, distinct code", async () => {
    const tierErr = makeTierError("LINKEDIN_FEATURE_NOT_SUBSCRIBED");
    (ns.recruiter.searchPeople as Mock).mockRejectedValue(tierErr);

    const { CurviateError } = await import("@curviate/sdk");
    Object.setPrototypeOf(tierErr, CurviateError.prototype);

    const { runRecruiterSearchPeople } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterSearchPeople(client as never, { account: "acc_1", json: true }, out);
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(5)");
    } finally {
      exitSpy.mockRestore();
    }

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.error.code).toBe("LINKEDIN_FEATURE_NOT_SUBSCRIBED");
  });

  it("per-command gate independence — recruiter sync stubbed independently → exit 5", async () => {
    const tierErr = makeTierError("TIER_NOT_ACTIVE", "recruiter");
    (ns.recruiter.syncMessages as Mock).mockRejectedValue(tierErr);

    const { CurviateError } = await import("@curviate/sdk");
    Object.setPrototypeOf(tierErr, CurviateError.prototype);

    const { runRecruiterSync } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterSync(client as never, { account: "acc_1", json: true }, out);
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(5)");
    } finally {
      exitSpy.mockRestore();
    }

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.error.code).toBe("TIER_NOT_ACTIVE");
    expect(parsed.error.requiredTier).toBe("recruiter");
  });

  it("per-command gate independence — recruiter profile stubbed independently → exit 5", async () => {
    const tierErr = makeTierError("TIER_NOT_ACTIVE", "recruiter");
    (ns.recruiter.getProfile as Mock).mockRejectedValue(tierErr);

    const { CurviateError } = await import("@curviate/sdk");
    Object.setPrototypeOf(tierErr, CurviateError.prototype);

    const { runRecruiterProfile } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterProfile(client as never, { account: "acc_1", identifier: "jdoe", json: true }, out);
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(5)");
    } finally {
      exitSpy.mockRestore();
    }

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.error.requiredTier).toBe("recruiter");
  });
});

// ─── recruiter sync ────────────────────────────────────────────────────────

describe("recruiter sync", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.syncMessages as Mock).mockResolvedValue({ object: "sync_result" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.syncMessages with account scoping", async () => {
    const { runRecruiterSync } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterSync(client as never, { account: "acc_1", json: true }, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.recruiter.syncMessages).toHaveBeenCalled();
  });

  it("--preview on read: exits 2", async () => {
    const { runRecruiterSync } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterSync(client as never, { account: "acc_1", preview: true }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.recruiter.syncMessages).not.toHaveBeenCalled();
  });
});

// ─── recruiter message new ─────────────────────────────────────────────────

describe("recruiter message new", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;
  let tmpDir: string;

  beforeEach(async () => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.startChat as Mock).mockResolvedValue({ chat_id: "rec_chat_1" });
    tmpDir = await mkdtemp(join(tmpdir(), "curviate-test-rec-"));
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("calls recruiter.startChat with to and text", async () => {
    const { runRecruiterMessageNew } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterMessageNew(client as never, {
      account: "acc_1",
      to: "AEM789",
      text: "hello recruiter",
      json: true,
    }, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.recruiter.startChat).toHaveBeenCalledWith(
      expect.objectContaining({ attendees_ids: ["AEM789"], text: "hello recruiter" }),
    );
  });

  // ── Wire-encoding regression: the Recruiter chat body MUST use `attendees_ids`
  // (PLURAL) — matches the server-renamed field (F2, SN/Recruiter parity pass).
  // A prior version sent the singular `attendee_ids` → guaranteed API 400.
  it("recruiter message new — body uses attendees_ids (plural), not attendee_ids", async () => {
    const { runRecruiterMessageNew } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterMessageNew(client as never, {
      account: "acc_1",
      to: "AEM789",
      text: "hello recruiter",
      json: true,
    }, out);

    const body = (ns.recruiter.startChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["attendees_ids"]).toEqual(["AEM789"]);
    expect(body["text"]).toBe("hello recruiter");
    // The singular form must NOT appear — it was the old pre-parity field name.
    expect(body).not.toHaveProperty("attendee_ids");
  });

  it("--attach file passes Buffer in attachments", async () => {
    const filePath = join(tmpDir, "resume.pdf");
    await writeFile(filePath, "pdfcontent");

    const { runRecruiterMessageNew } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterMessageNew(client as never, {
      account: "acc_1",
      to: "AEM789",
      text: "hello",
      attach: filePath,
      json: true,
    }, out);

    const callArgs = (ns.recruiter.startChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    const attachments = callArgs["attachments"] as Buffer[];
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments[0]).toBeInstanceOf(Buffer);
  });

  it("--voice file passes Buffer as voice_message", async () => {
    const voicePath = join(tmpDir, "voice.ogg");
    await writeFile(voicePath, "voicedata");

    const { runRecruiterMessageNew } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterMessageNew(client as never, {
      account: "acc_1",
      to: "AEM789",
      text: "hello",
      voice: voicePath,
      json: true,
    }, out);

    const callArgs = (ns.recruiter.startChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["voice_message"]).toBeInstanceOf(Buffer);
  });

  it("--video file passes Buffer as video_message", async () => {
    const videoPath = join(tmpDir, "video.mp4");
    await writeFile(videoPath, "videodata");

    const { runRecruiterMessageNew } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterMessageNew(client as never, {
      account: "acc_1",
      to: "AEM789",
      text: "hello",
      video: videoPath,
      json: true,
    }, out);

    const callArgs = (ns.recruiter.startChat as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs["video_message"]).toBeInstanceOf(Buffer);
  });

  it("--preview renders request, does not call startChat", async () => {
    const { runRecruiterMessageNew } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterMessageNew(client as never, {
      account: "acc_1",
      to: "AEM789",
      text: "hello",
      preview: true,
    }, out);

    expect(ns.recruiter.startChat).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("recruiter.startChat");
  });

  it("--attach missing file exits 2 before startChat", async () => {
    const { runRecruiterMessageNew } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterMessageNew(client as never, {
        account: "acc_1",
        to: "AEM789",
        text: "hello",
        attach: join(tmpDir, "no-such-file.txt"),
      }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.recruiter.startChat).not.toHaveBeenCalled();
  });
});

// ─── recruiter profile ─────────────────────────────────────────────────────

describe("recruiter profile", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.getProfile as Mock).mockResolvedValue({ id: "p1", name: "Jane" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.getProfile with identifier resolved via resolveIdentifier", async () => {
    const { runRecruiterProfile } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterProfile(client as never, {
      account: "acc_1",
      identifier: "https://www.linkedin.com/in/jane-doe",
      json: true,
    }, out);

    expect(ns.recruiter.getProfile).toHaveBeenCalledWith("jane-doe", expect.anything());
  });

  it("bare slug is passed through unchanged", async () => {
    const { runRecruiterProfile } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterProfile(client as never, {
      account: "acc_1",
      identifier: "jdoe",
      json: true,
    }, out);

    expect(ns.recruiter.getProfile).toHaveBeenCalledWith("jdoe", expect.anything());
  });

  it("--preview on read: exits 2", async () => {
    const { runRecruiterProfile } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterProfile(client as never, { account: "acc_1", identifier: "jdoe", preview: true }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.recruiter.getProfile).not.toHaveBeenCalled();
  });
});

// ─── recruiter search people ───────────────────────────────────────────────

describe("recruiter search people", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.searchPeople as Mock).mockResolvedValue({ items: [{ id: "a1" }], cursor: null });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.searchPeople with body (POST shape)", async () => {
    const { runRecruiterSearchPeople } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterSearchPeople(client as never, { account: "acc_1", keywords: "ml", json: true }, out);

    expect(ns.recruiter.searchPeople).toHaveBeenCalled();
    const callArgs = (ns.recruiter.searchPeople as Mock).mock.calls[0] as [Record<string, unknown>];
    // First argument is the body (POST)
    expect(typeof callArgs[0]).toBe("object");
    expect(callArgs[0]).toEqual({ keywords: "ml" });
  });

  it("--filters '<json>' merges nested filter objects into the POST body verbatim", async () => {
    const { runRecruiterSearchPeople } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterSearchPeople(client as never, {
      account: "acc_1",
      filters: '{"industry":{"include":["96"]},"seniority":{"include":["3"]}}',
      json: true,
    }, out);

    const body = (ns.recruiter.searchPeople as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({ industry: { include: ["96"] }, seniority: { include: ["3"] } });
  });

  it("--keywords + --filters combine; named flags map to exact API fields", async () => {
    const { runRecruiterSearchPeople } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterSearchPeople(client as never, {
      account: "acc_1",
      keywords: "ml",
      filters: '{"industry":{"include":["96"]}}',
      locale: "en",
      "employment-type": "FULL_TIME,CONTRACT",
      function: "eng",
      "profile-language": "en,de",
      json: true,
    }, out);

    const body = (ns.recruiter.searchPeople as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({
      industry: { include: ["96"] },
      keywords: "ml",
      locale: "en",
      employment_type: ["FULL_TIME", "CONTRACT"],
      function: ["eng"],
      profile_language: ["en", "de"],
    });
  });

  it("bad --filters JSON exits 2 before any SDK call", async () => {
    const { runRecruiterSearchPeople } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterSearchPeople(client as never, { account: "acc_1", filters: "{bad" }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.recruiter.searchPeople).not.toHaveBeenCalled();
  });

  it("--preview exits 2", async () => {
    const { runRecruiterSearchPeople } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterSearchPeople(client as never, { account: "acc_1", preview: true }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.recruiter.searchPeople).not.toHaveBeenCalled();
  });

  it("--all streams all pages via POST search", async () => {
    (ns.recruiter.searchPeople as Mock)
      .mockResolvedValueOnce({ items: [{ id: "a1" }], cursor: "cur_1" })
      .mockResolvedValueOnce({ items: [{ id: "a2" }], cursor: null });

    const { runRecruiterSearchPeople } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterSearchPeople(client as never, { account: "acc_1", all: true, json: true }, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("\n");
    const lines = written.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!)).toEqual({ id: "a1" });
    expect(JSON.parse(lines[1]!)).toEqual({ id: "a2" });
  });
});

// ─── recruiter search parameters ──────────────────────────────────────────

describe("recruiter search parameters", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.getParameters as Mock).mockResolvedValue({ items: [] });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.getParameters with type param", async () => {
    const { runRecruiterGetParameters } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterGetParameters(client as never, { account: "acc_1", type: "LOCATION", json: true }, out);

    expect(ns.recruiter.getParameters).toHaveBeenCalledWith(
      expect.objectContaining({ type: "LOCATION" }),
    );
  });

  it("wires --keywords and --limit into the query alongside --type", async () => {
    const { runRecruiterGetParameters } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterGetParameters(client as never, {
      account: "acc_1",
      type: "LOCATION",
      keywords: "Berlin",
      limit: "10",
      json: true,
    }, out);

    expect(ns.recruiter.getParameters).toHaveBeenCalledWith({ type: "LOCATION", keywords: "Berlin", limit: 10 });
  });
});

// ─── recruiter projects ────────────────────────────────────────────────────

describe("recruiter projects", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.listProjects as Mock).mockResolvedValue({ items: [{ id: "proj_1" }], cursor: null });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.listProjects", async () => {
    const { runRecruiterListProjects } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterListProjects(client as never, { account: "acc_1", json: true }, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    expect(ns.recruiter.listProjects).toHaveBeenCalled();
  });

  it("--all streams all pages", async () => {
    (ns.recruiter.listProjects as Mock)
      .mockResolvedValueOnce({ items: [{ id: "proj_1" }], cursor: "cur_1" })
      .mockResolvedValueOnce({ items: [{ id: "proj_2" }], cursor: null });

    const { runRecruiterListProjects } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterListProjects(client as never, { account: "acc_1", all: true, json: true }, out);

    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("\n");
    const lines = written.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
  });
});

// ─── recruiter project <project_id> ───────────────────────────────────────

describe("recruiter project", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.getProject as Mock).mockResolvedValue({ id: "proj_1", name: "Q3 Hiring" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.getProject with projectId verbatim (no resolveIdentifier)", async () => {
    const { runRecruiterGetProject } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterGetProject(client as never, {
      account: "acc_1",
      projectId: "proj_abc",
      json: true,
    }, out);

    // project_id is a native id — must NOT be URL-resolved
    expect(ns.recruiter.getProject).toHaveBeenCalledWith("proj_abc");
  });
});

// ─── recruiter add-candidate ───────────────────────────────────────────────

describe("recruiter add-candidate", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.addCandidate as Mock).mockResolvedValue({ success: true });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.addCandidate with userId verbatim and body", async () => {
    const { runRecruiterAddCandidate } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterAddCandidate(client as never, {
      account: "acc_1",
      userId: "AEM123",
      "hiring-project-id": "proj_abc",
      json: true,
    }, out);

    expect(ns.recruiter.addCandidate).toHaveBeenCalledWith(
      "AEM123",
      expect.objectContaining({ hiring_project_id: "proj_abc" }),
    );
  });

  it("--preview renders request, does not call addCandidate", async () => {
    const { runRecruiterAddCandidate } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterAddCandidate(client as never, {
      account: "acc_1",
      userId: "AEM123",
      "hiring-project-id": "proj_abc",
      preview: true,
    }, out);

    expect(ns.recruiter.addCandidate).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("recruiter.addCandidate");
  });
});

// ─── recruiter add-applicant ───────────────────────────────────────────────

describe("recruiter add-applicant", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.addApplicant as Mock).mockResolvedValue({ success: true });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.addApplicant with userId verbatim and body", async () => {
    const { runRecruiterAddApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterAddApplicant(client as never, {
      account: "acc_1",
      userId: "AEM456",
      "hiring-project-id": "proj_xyz",
      json: true,
    }, out);

    expect(ns.recruiter.addApplicant).toHaveBeenCalledWith(
      "AEM456",
      expect.objectContaining({ hiring_project_id: "proj_xyz" }),
    );
  });

  it("--preview renders request, does not call addApplicant", async () => {
    const { runRecruiterAddApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterAddApplicant(client as never, {
      account: "acc_1",
      userId: "AEM456",
      "hiring-project-id": "proj_xyz",
      preview: true,
    }, out);

    expect(ns.recruiter.addApplicant).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("recruiter.addApplicant");
  });
});

// ─── recruiter reject-applicant ───────────────────────────────────────────

describe("recruiter reject-applicant", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.rejectApplicant as Mock).mockResolvedValue({ success: true });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.rejectApplicant with userId verbatim, hiring-project-id, and reason in body", async () => {
    const { runRecruiterRejectApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterRejectApplicant(client as never, {
      account: "acc_1",
      userId: "AEM789",
      "hiring-project-id": "proj_abc",
      reason: "NOT_MEET_BASIC_QUALIFICATIONS",
      json: true,
    }, out);

    expect(ns.recruiter.rejectApplicant).toHaveBeenCalledWith(
      "AEM789",
      expect.objectContaining({
        hiring_project_id: "proj_abc",
        reason: "NOT_MEET_BASIC_QUALIFICATIONS",
      }),
    );
  });

  it("--preview renders request, does not call rejectApplicant", async () => {
    const { runRecruiterRejectApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterRejectApplicant(client as never, {
      account: "acc_1",
      userId: "AEM789",
      "hiring-project-id": "proj_abc",
      reason: "NOT_MEET_BASIC_QUALIFICATIONS",
      preview: true,
    }, out);

    expect(ns.recruiter.rejectApplicant).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("recruiter.rejectApplicant");
  });

  it("omitting --message and --notify-at sends no rejection_notification (default: applicant not notified)", async () => {
    const { runRecruiterRejectApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterRejectApplicant(client as never, {
      account: "acc_1",
      userId: "AEM789",
      "hiring-project-id": "proj_abc",
      reason: "NOT_MEET_BASIC_QUALIFICATIONS",
      json: true,
    }, out);

    const body = (ns.recruiter.rejectApplicant as Mock).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("rejection_notification");
  });

  it("--message alone adds rejection_notification.message, no send_notification_at", async () => {
    const { runRecruiterRejectApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterRejectApplicant(client as never, {
      account: "acc_1",
      userId: "AEM789",
      "hiring-project-id": "proj_abc",
      reason: "NOT_MEET_BASIC_QUALIFICATIONS",
      message: "Thanks for applying — we've decided to move forward with other candidates.",
      json: true,
    }, out);

    expect(ns.recruiter.rejectApplicant).toHaveBeenCalledWith(
      "AEM789",
      expect.objectContaining({
        rejection_notification: {
          message: "Thanks for applying — we've decided to move forward with other candidates.",
        },
      }),
    );
    const body = (ns.recruiter.rejectApplicant as Mock).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body["rejection_notification"]).not.toHaveProperty("send_notification_at");
  });

  it("--message + --notify-at adds both fields, send_notification_at as a number", async () => {
    const { runRecruiterRejectApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterRejectApplicant(client as never, {
      account: "acc_1",
      userId: "AEM789",
      "hiring-project-id": "proj_abc",
      reason: "NOT_MEET_BASIC_QUALIFICATIONS",
      message: "Thanks for applying.",
      "notify-at": "1735689600000",
      json: true,
    }, out);

    expect(ns.recruiter.rejectApplicant).toHaveBeenCalledWith(
      "AEM789",
      expect.objectContaining({
        rejection_notification: {
          message: "Thanks for applying.",
          send_notification_at: 1735689600000,
        },
      }),
    );
    const body = (ns.recruiter.rejectApplicant as Mock).mock.calls[0]?.[1] as Record<string, unknown>;
    const notification = body["rejection_notification"] as Record<string, unknown>;
    expect(typeof notification["send_notification_at"]).toBe("number");
  });

  it("--notify-at without --message → usage error, exit 2, no SDK call", async () => {
    const { runRecruiterRejectApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterRejectApplicant(client as never, {
        account: "acc_1",
        userId: "AEM789",
        "hiring-project-id": "proj_abc",
        reason: "NOT_MEET_BASIC_QUALIFICATIONS",
        "notify-at": "1735689600000",
        json: true,
      }, out);
      expect.fail("expected process.exit(2)");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }

    expect(ns.recruiter.rejectApplicant).not.toHaveBeenCalled();
    const stderrWritten = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrWritten).toContain("--message");
  });

  it("non-numeric --notify-at (with --message) → usage error, exit 2, no SDK call", async () => {
    const { runRecruiterRejectApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterRejectApplicant(client as never, {
        account: "acc_1",
        userId: "AEM789",
        "hiring-project-id": "proj_abc",
        reason: "NOT_MEET_BASIC_QUALIFICATIONS",
        message: "Thanks for applying.",
        "notify-at": "not-a-number",
        json: true,
      }, out);
      expect.fail("expected process.exit(2)");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }

    expect(ns.recruiter.rejectApplicant).not.toHaveBeenCalled();
    const stderrWritten = (out.stderr.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    expect(stderrWritten).toContain("--notify-at");
  });

  it("--preview with --message renders rejection_notification in the previewed body", async () => {
    const { runRecruiterRejectApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterRejectApplicant(client as never, {
      account: "acc_1",
      userId: "AEM789",
      "hiring-project-id": "proj_abc",
      reason: "NOT_MEET_BASIC_QUALIFICATIONS",
      message: "Thanks for applying.",
      "notify-at": "1735689600000",
      preview: true,
    }, out);

    expect(ns.recruiter.rejectApplicant).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.body.rejection_notification).toEqual({
      message: "Thanks for applying.",
      send_notification_at: 1735689600000,
    });
  });
});

// ─── recruiter jobs ────────────────────────────────────────────────────────

describe("recruiter jobs", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.listJobs as Mock).mockResolvedValue({ items: [{ id: "job_1" }], cursor: null });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.listJobs", async () => {
    const { runRecruiterListJobs } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterListJobs(client as never, { account: "acc_1", json: true }, out);

    expect(ns.recruiter.listJobs).toHaveBeenCalled();
  });
});

// ─── recruiter job create ──────────────────────────────────────────────────

describe("recruiter job create", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;
  let tmpDir: string;

  // Injectable readers so the JSON-body source can be exercised without real
  // process.stdin / fs I/O. The real --body-file path is exercised via a temp file.
  function makeReaders(opts: { file?: string; stdin?: string } = {}) {
    return {
      readFile: vi.fn(async () => {
        if (opts.file === undefined) throw new Error("no file");
        return opts.file;
      }),
      readStdin: vi.fn(async () => opts.stdin ?? ""),
    };
  }

  // A complete, API-valid job-create body (every OpenAPI-required field).
  // required = [account_id, job_title, company, workplace, location, description, recruiter].
  const FULL_BODY = {
    job_title: { text: "Senior AI Engineer" },
    company: { id: "1441" },
    workplace: "REMOTE",
    location: "103644278",
    description: "<p>Build agents.</p>",
    recruiter: { project: { id: "proj_1" } },
  };

  beforeEach(async () => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.createJob as Mock).mockResolvedValue({ job_id: "job_new", status: "draft" });
    tmpDir = await mkdtemp(join(tmpdir(), "curviate-test-job-"));
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Wire-encoding regression: a prior version built `const body = {}` and
  // never populated it — 0 fields wired → guaranteed API 400. This asserts the
  // JSON body source is read and every field reaches the SDK verbatim.
  it("--body-file — reads the JSON file and passes the full body to createJob (every required field)", async () => {
    const filePath = join(tmpDir, "job.json");
    await writeFile(filePath, JSON.stringify(FULL_BODY));

    const { runRecruiterCreateJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    // Real fs reader (no injection): exercises the actual --body-file path.
    await runRecruiterCreateJob(client as never, {
      account: "acc_1",
      "body-file": filePath,
      json: true,
    }, out);

    expect(client.account).toHaveBeenCalledWith("acc_1");
    const body = (ns.recruiter.createJob as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual(FULL_BODY);
    // Spot-check the required keys are all present with correct names.
    for (const k of ["job_title", "company", "workplace", "location", "description", "recruiter"]) {
      expect(body).toHaveProperty(k);
    }
  });

  it("--body - — reads the JSON body from stdin", async () => {
    const { runRecruiterCreateJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const readers = makeReaders({ stdin: JSON.stringify(FULL_BODY) });

    await runRecruiterCreateJob(client as never, {
      account: "acc_1",
      body: "-",
      json: true,
    }, out, readers);

    expect(readers.readStdin).toHaveBeenCalled();
    const body = (ns.recruiter.createJob as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual(FULL_BODY);
  });

  it("scalar convenience flags merge OVER the JSON body", async () => {
    const { runRecruiterCreateJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    // JSON sets job_title/description; the scalar flags must override them.
    const readers = makeReaders({
      stdin: JSON.stringify({ ...FULL_BODY, description: "OLD", employment_type: "PART_TIME" }),
    });

    await runRecruiterCreateJob(client as never, {
      account: "acc_1",
      body: "-",
      "job-title": "Staff Engineer",
      description: "NEW",
      "employment-type": "FULL_TIME",
      json: true,
    }, out, readers);

    const body = (ns.recruiter.createJob as Mock).mock.calls[0]![0] as Record<string, unknown>;
    // --job-title maps to job_title.text (job_title is an object in the API).
    expect(body["job_title"]).toEqual({ text: "Staff Engineer" });
    expect(body["description"]).toBe("NEW");
    expect(body["employment_type"]).toBe("FULL_TIME");
    // Untouched JSON fields survive.
    expect(body["company"]).toEqual(FULL_BODY.company);
    expect(body["recruiter"]).toEqual(FULL_BODY.recruiter);
  });

  it("scalar flags alone (no JSON source) assemble a partial body", async () => {
    const { runRecruiterCreateJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterCreateJob(client as never, {
      account: "acc_1",
      "job-title": "Engineer",
      description: "Build things",
      json: true,
    }, out);

    const body = (ns.recruiter.createJob as Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({ job_title: { text: "Engineer" }, description: "Build things" });
  });

  it("invalid JSON from --body-file exits 2 before any SDK call", async () => {
    const filePath = join(tmpDir, "bad.json");
    await writeFile(filePath, "{ not valid json ");

    const { runRecruiterCreateJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterCreateJob(client as never, {
        account: "acc_1",
        "body-file": filePath,
      }, out);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.recruiter.createJob).not.toHaveBeenCalled();
  });

  it("non-object JSON (array) from stdin exits 2 before any SDK call", async () => {
    const { runRecruiterCreateJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const readers = makeReaders({ stdin: "[1,2,3]" });
    const exitSpy = mockExit();

    try {
      await runRecruiterCreateJob(client as never, {
        account: "acc_1",
        body: "-",
      }, out, readers);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.recruiter.createJob).not.toHaveBeenCalled();
  });

  it("--preview shows the fully assembled body (JSON + scalar flags)", async () => {
    const { runRecruiterCreateJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const readers = makeReaders({ stdin: JSON.stringify(FULL_BODY) });

    await runRecruiterCreateJob(client as never, {
      account: "acc_1",
      body: "-",
      "job-title": "Lead Engineer",
      preview: true,
    }, out, readers);

    expect(ns.recruiter.createJob).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("recruiter.createJob");
    // Honest preview: the assembled body carries the merged scalar override.
    expect(parsed.body.job_title).toEqual({ text: "Lead Engineer" });
    expect(parsed.body.company).toEqual(FULL_BODY.company);
  });
});

// ─── recruiter job publish ─────────────────────────────────────────────────

describe("recruiter job publish", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.publishJob as Mock).mockResolvedValue({ object: "job_posting_published", job_id: "job_1" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.publishJob with jobId verbatim", async () => {
    const { runRecruiterPublishJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterPublishJob(client as never, {
      account: "acc_1",
      jobId: "job_42",
      mode: "FREE",
      json: true,
    }, out);

    expect(ns.recruiter.publishJob).toHaveBeenCalledWith(
      "job_42",
      expect.objectContaining({ mode: "FREE" }),
    );
  });

  it("--preview renders request, does not call publishJob", async () => {
    const { runRecruiterPublishJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterPublishJob(client as never, {
      account: "acc_1",
      jobId: "job_42",
      mode: "FREE",
      preview: true,
    }, out);

    expect(ns.recruiter.publishJob).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("recruiter.publishJob");
  });
});

// ─── recruiter job checkpoint ──────────────────────────────────────────────

describe("recruiter job checkpoint", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.solveJobCheckpoint as Mock).mockResolvedValue({ object: "job_posting_published", job_id: "job_1" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.solveJobCheckpoint with jobId verbatim and input in body", async () => {
    const { runRecruiterJobCheckpoint } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterJobCheckpoint(client as never, {
      account: "acc_1",
      jobId: "job_42",
      input: "739204",
      json: true,
    }, out);

    expect(ns.recruiter.solveJobCheckpoint).toHaveBeenCalledWith(
      "job_42",
      expect.objectContaining({ input: "739204" }),
    );
  });

  it("--preview renders request, does not call solveJobCheckpoint", async () => {
    const { runRecruiterJobCheckpoint } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterJobCheckpoint(client as never, {
      account: "acc_1",
      jobId: "job_42",
      input: "739204",
      preview: true,
    }, out);

    expect(ns.recruiter.solveJobCheckpoint).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("recruiter.solveJobCheckpoint");
  });
});

// ─── recruiter job applicants ──────────────────────────────────────────────

describe("recruiter job applicants", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.listApplicants as Mock).mockResolvedValue({ items: [{ id: "app_1" }], cursor: null });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.listApplicants with jobId verbatim", async () => {
    const { runRecruiterListApplicants } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterListApplicants(client as never, {
      account: "acc_1",
      jobId: "job_99",
      json: true,
    }, out);

    // Second arg is optional params; when no pagination flags are set, passes undefined.
    const calls = (ns.recruiter.listApplicants as Mock).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toBe("job_99");
  });
});

// ─── recruiter applicant ──────────────────────────────────────────────────

describe("recruiter applicant", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.getApplicant as Mock).mockResolvedValue({ id: "app_1", name: "Alice" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.getApplicant with applicantId verbatim (no resolveIdentifier)", async () => {
    const { runRecruiterGetApplicant } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterGetApplicant(client as never, {
      account: "acc_1",
      applicantId: "app_abc",
      json: true,
    }, out);

    expect(ns.recruiter.getApplicant).toHaveBeenCalledWith("app_abc");
  });
});

// ─── recruiter applicant resume ────────────────────────────────────────────

describe("recruiter applicant resume", () => {
  let ns: ReturnType<typeof makeRecruiterNs>;
  let client: ReturnType<typeof makeClient>;
  let tmpDir: string;

  beforeEach(async () => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    tmpDir = await mkdtemp(join(tmpdir(), "curviate-test-rec-resume-"));
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("-o <file> writes ArrayBuffer bytes to disk, exit 0", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    (ns.recruiter.downloadResume as Mock).mockResolvedValue(bytes.buffer);

    const { runRecruiterDownloadResume } = await import("../../src/commands/recruiter.js");
    const outPath = join(tmpDir, "resume.pdf");
    const out = makeOut();

    await runRecruiterDownloadResume(client as never, {
      account: "acc_1",
      applicantId: "app_1",
      output: outPath,
    }, out, false /* isTTY=false */);

    const written = await readFile(outPath);
    expect(written).toEqual(Buffer.from(bytes.buffer));
    expect(ns.recruiter.downloadResume).toHaveBeenCalledWith("app_1");
  });

  it("TTY without -o exits 2", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    (ns.recruiter.downloadResume as Mock).mockResolvedValue(bytes.buffer);

    const { runRecruiterDownloadResume } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterDownloadResume(client as never, {
        account: "acc_1",
        applicantId: "app_1",
      }, out, true /* isTTY=true, no -o */);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("--preview on read: exits 2", async () => {
    const { runRecruiterDownloadResume } = await import("../../src/commands/recruiter.js");
    const out = makeOut();
    const exitSpy = mockExit();

    try {
      await runRecruiterDownloadResume(client as never, {
        account: "acc_1",
        applicantId: "app_1",
        preview: true,
      }, out, false);
      expect.fail("should have exited");
    } catch (e) {
      expect((e as Error).message).toContain("process.exit(2)");
    } finally {
      exitSpy.mockRestore();
    }
    expect(ns.recruiter.downloadResume).not.toHaveBeenCalled();
  });
});

// no recruiter inmail-balance in registry

describe("recruiter registry has no inmail-balance", () => {
  it("recruiterCommand does not have an inmail-balance subcommand", async () => {
    vi.resetModules();
    const { recruiterCommand } = await import("../../src/commands/recruiter.js");
    const subCommands = (recruiterCommand as { subCommands?: Record<string, unknown> }).subCommands ?? {};
    expect("inmail-balance" in subCommands).toBe(false);
  });
});
