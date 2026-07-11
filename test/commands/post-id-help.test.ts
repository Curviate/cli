/**
 * post <post_id> help text — URL acceptance + comment guidance
 *
 * All post subcommands taking <post_id> must describe it as accepting:
 *   - numeric id
 *   - urn:li:activity:N
 *   - full LinkedIn share URL
 *
 * post get: description notes POSTID is the post's id and points at the
 *   `comment list <post_id>` command for a post's comments.
 * post react: v2 has no --comment-id (comment-level reactions moved to the
 *   comment group) — the description must not claim it exists.
 *
 * Note: actual URL extraction round-trip is server scope.
 * This test covers help text only.
 */

import { describe, it, expect } from "vitest";

async function getPostSubCmdArgs() {
  const { postCommand } = await import("../../src/commands/post.js");
  return (postCommand as Record<string, unknown>).subCommands as Record<
    string,
    { args?: Record<string, { description?: string }> }
  >;
}

describe("post <post_id> descriptions — URL acceptance + comment guidance", () => {
  it("post get — postId description mentions LinkedIn share URL", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["get"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/url|share url|linkedin/i);
  });

  it("post reactions — postId description mentions LinkedIn share URL", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["reactions"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/url|share url|linkedin/i);
  });

  it("post react — postId description mentions LinkedIn share URL or urn", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["react"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/url|urn|linkedin/i);
  });

  it("post get — postId description points at the comment group for a post's comments", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["get"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/comment list/i);
  });

  it("post react — has no --comment-id flag (v2: comment reactions moved to the comments.* group)", async () => {
    const subCmds = await getPostSubCmdArgs();
    expect(subCmds["react"]?.args?.["comment-id"]).toBeUndefined();
  });
});
