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

type RecruiterFlags = {
  account?: string;
  json?: boolean;
  fields?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  "max-pages"?: string;
  preview?: boolean;
  "api-key"?: string;
  "base-url"?: string;
  timeout?: string;
  profile?: string;
  // Subcommand-specific
  to?: string;
  text?: string;
  attach?: string | string[];
  voice?: string;
  video?: string;
  type?: string;
  keywords?: string;
  identifier?: string;
  userId?: string;
  projectId?: string;
  jobId?: string;
  applicantId?: string;
  "hiring-project-id"?: string;
  stage?: string;
  reason?: string;
  mode?: string;
  input?: string;
  output?: string;
};

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

  it("TS-002: recruiter projects — TIER_NOT_ACTIVE → exit 5, requiredTier:recruiter", async () => {
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

  it("TS-003: recruiter search people — LINKEDIN_FEATURE_NOT_SUBSCRIBED → exit 5, distinct code", async () => {
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

  it("TS-004: per-command gate independence — recruiter sync stubbed independently → exit 5", async () => {
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

  it("TS-004: per-command gate independence — recruiter profile stubbed independently → exit 5", async () => {
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

  it("TS-005: calls recruiter.searchPeople with body (POST shape)", async () => {
    const { runRecruiterSearchPeople } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterSearchPeople(client as never, { account: "acc_1", keywords: "ml", json: true }, out);

    expect(ns.recruiter.searchPeople).toHaveBeenCalled();
    const callArgs = (ns.recruiter.searchPeople as Mock).mock.calls[0] as [Record<string, unknown>];
    // First argument is the body (POST)
    expect(typeof callArgs[0]).toBe("object");
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

  beforeEach(() => {
    ns = makeRecruiterNs();
    client = makeClient(ns);
    (ns.recruiter.createJob as Mock).mockResolvedValue({ job_id: "job_new", status: "draft" });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls recruiter.createJob with body from flags", async () => {
    const { runRecruiterCreateJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterCreateJob(client as never, {
      account: "acc_1",
      json: true,
    }, out);

    expect(ns.recruiter.createJob).toHaveBeenCalledWith(expect.any(Object));
  });

  it("--preview renders request, does not call createJob", async () => {
    const { runRecruiterCreateJob } = await import("../../src/commands/recruiter.js");
    const out = makeOut();

    await runRecruiterCreateJob(client as never, {
      account: "acc_1",
      preview: true,
    }, out);

    expect(ns.recruiter.createJob).not.toHaveBeenCalled();
    const written = (out.stdout.write as Mock).mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(written);
    expect(parsed.method).toBe("recruiter.createJob");
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

describe("recruiter applicant resume (TS-006)", () => {
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

  it("TS-006: -o <file> writes ArrayBuffer bytes to disk, exit 0", async () => {
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

// ─── TS-005: no recruiter inmail-balance in registry ────────────────────

describe("TS-005: recruiter registry has no inmail-balance", () => {
  it("recruiterCommand does not have an inmail-balance subcommand", async () => {
    vi.resetModules();
    const { recruiterCommand } = await import("../../src/commands/recruiter.js");
    const subCommands = (recruiterCommand as { subCommands?: Record<string, unknown> }).subCommands ?? {};
    expect("inmail-balance" in subCommands).toBe(false);
  });
});
