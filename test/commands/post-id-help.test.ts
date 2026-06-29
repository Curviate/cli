/**
 * post <post_id> help text — URL acceptance + comment guidance
 *
 * All post subcommands taking <post_id> must describe it as accepting:
 *   - numeric id
 *   - urn:li:activity:N
 *   - full LinkedIn share URL
 *
 * post comments and post get: description notes POSTID is the post's id;
 *   to target a comment within the post, use --reply-to.
 * post react: description notes to react to a comment, use --comment-id.
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

  it("post comments — postId description mentions LinkedIn share URL", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["comments"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/url|share url|linkedin/i);
  });

  it("post reactions — postId description mentions LinkedIn share URL", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["reactions"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/url|share url|linkedin/i);
  });

  it("post comment (write) — postId description mentions LinkedIn share URL or urn", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["comment"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/url|urn|linkedin/i);
  });

  it("post react — postId description mentions LinkedIn share URL or urn", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["react"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/url|urn|linkedin/i);
  });

  it("post comments — postId description guides: POSTID is post's id, use --reply-to for comments", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["comments"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/reply-to|reply to/i);
  });

  it("post get — postId description guides: use --reply-to for comment targeting", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["get"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/reply-to|reply to/i);
  });

  it("post react — postId description guides: use --comment-id to react to a comment", async () => {
    const subCmds = await getPostSubCmdArgs();
    const postIdDesc = subCmds["react"]?.args?.["postId"]?.description ?? "";
    expect(postIdDesc.toLowerCase()).toMatch(/comment-id|comment id/i);
  });
});
