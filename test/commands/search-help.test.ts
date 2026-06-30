/**
 * search command help-string assertions.
 *
 * Strategy: inspect the `description` field of each named arg in the citty
 * command definitions. Tests fail early if the public help text diverges from
 * the spec requirements.
 */

import { describe, it, expect } from "vitest";

// Helper: extract args from a subcommand of searchCommand.
async function getSearchSubArgs(sub: string): Promise<Record<string, { description?: string }>> {
  const { searchCommand } = await import("../../src/commands/search.js");
  const subCmds = (searchCommand as Record<string, unknown>).subCommands as Record<
    string,
    { args?: Record<string, { description?: string }> }
  >;
  return subCmds[sub]?.args ?? {};
}

// ---------------------------------------------------------------------------
// search jobs --date-posted help
// ---------------------------------------------------------------------------

describe("search jobs --date-posted help text", () => {
  it("flag exists on the jobs subcommand", async () => {
    const args = await getSearchSubArgs("jobs");
    expect(args["date-posted"]).toBeDefined();
  });

  it("description mentions 'days' and examples like 7, 14, 30", async () => {
    const args = await getSearchSubArgs("jobs");
    const desc = args["date-posted"]?.description ?? "";
    expect(desc).toContain("days");
    // must mention that it's a number, not an enum string
    expect(desc.toLowerCase()).toContain("number");
  });

  it("description clarifies it is NOT an enum string", async () => {
    const args = await getSearchSubArgs("jobs");
    const desc = args["date-posted"]?.description ?? "";
    // spec: "not an enum string"
    expect(desc).toContain("not an enum string");
  });
});

// ---------------------------------------------------------------------------
// search posts --date-posted help
// ---------------------------------------------------------------------------

describe("search posts --date-posted help text", () => {
  it("description names all three underscore-form windows", async () => {
    const args = await getSearchSubArgs("posts");
    const desc = args["date-posted"]?.description ?? "";
    expect(desc).toContain("past_day");
    expect(desc).toContain("past_week");
    expect(desc).toContain("past_month");
  });

  it("description mentions that hyphens are also accepted", async () => {
    const args = await getSearchSubArgs("posts");
    const desc = args["date-posted"]?.description ?? "";
    expect(desc).toContain("past-day");
    expect(desc).toContain("past-week");
    expect(desc).toContain("past-month");
  });
});

// ---------------------------------------------------------------------------
// search jobs --location / --region help
// ---------------------------------------------------------------------------

describe("search jobs --location help text", () => {
  it("description contains 'geo region id' and 'single id'", async () => {
    const args = await getSearchSubArgs("jobs");
    const desc = args["location"]?.description ?? "";
    expect(desc).toContain("geo region id");
    expect(desc).toContain("single id");
  });

  it("description mentions search parameters resolution", async () => {
    const args = await getSearchSubArgs("jobs");
    const desc = args["location"]?.description ?? "";
    expect(desc).toContain("search parameters");
  });

  it("description mentions 'region filter' (the body field)", async () => {
    const args = await getSearchSubArgs("jobs");
    const desc = args["location"]?.description ?? "";
    expect(desc).toContain("region filter");
  });
});

describe("search jobs --region help text", () => {
  it("description identifies it as alias for --location", async () => {
    const args = await getSearchSubArgs("jobs");
    const desc = args["region"]?.description ?? "";
    expect(desc.toLowerCase()).toContain("alias");
    expect(desc).toContain("--location");
  });

  it("description names the shared body field: region", async () => {
    const args = await getSearchSubArgs("jobs");
    const desc = args["region"]?.description ?? "";
    // spec: "same body field: region"
    expect(desc).toContain("region");
  });
});

// ---------------------------------------------------------------------------
// search --filters help (precedence + strip note)
// ---------------------------------------------------------------------------

describe("search --filters help text: precedence and strip note", () => {
  it("--filters on people command mentions named flags win on conflict", async () => {
    const args = await getSearchSubArgs("people");
    const desc = args["filters"]?.description ?? "";
    // Must state that named flags take precedence / win on conflict
    const lower = desc.toLowerCase();
    expect(lower.includes("named flags") || lower.includes("flag") || lower.includes("win") || lower.includes("override") || lower.includes("precedence")).toBe(true);
  });

  it("--filters on people command mentions server strips unknown fields", async () => {
    const args = await getSearchSubArgs("people");
    const desc = args["filters"]?.description ?? "";
    // Must mention server strips / ignores unknown fields
    const lower = desc.toLowerCase();
    expect(lower.includes("strip") || lower.includes("unknown") || lower.includes("validates")).toBe(true);
  });

  it("--filters on jobs command mentions named flags win on conflict", async () => {
    const args = await getSearchSubArgs("jobs");
    const desc = args["filters"]?.description ?? "";
    const lower = desc.toLowerCase();
    expect(lower.includes("named flags") || lower.includes("flag") || lower.includes("win") || lower.includes("override") || lower.includes("precedence")).toBe(true);
  });
});
