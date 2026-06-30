/**
 * Command dispatcher — a thin pre-router around citty 0.1.6.
 *
 * WHY THIS EXISTS (citty 0.1.6 constraint):
 * citty's own `runCommand` mis-handles command nodes that declare BOTH a bare
 * positional argument AND `subCommands`:
 *
 *   1. MISROUTE — when the first non-flag token is not a registered subcommand
 *      keyword, citty throws `Unknown command <token>` and the node's own
 *      `run()` (the bare-positional handler) is never reached. So an intent-
 *      shaped form like `connect <slug>` or `profile <url>` is rejected.
 *   2. DOUBLE-RUN — when the first token IS a subcommand keyword, citty runs
 *      the subcommand AND THEN also runs the parent node's `run()` (the
 *      `if (cmd.run)` branch sits OUTSIDE the subcommand block). So
 *      `message new …` executes `new` (startChat) and then the parent send
 *      handler with the positional captured as `"new"`.
 *   3. USAGE-ERROR EXIT CODE — citty's `runMain` exits `1` for routing errors
 *      and bleeds a usage block to stderr; the CLI contract wants exit `2`.
 *
 * This dispatcher walks the command tree itself and resolves exactly ONE node
 * to execute, so a node may safely mix a bare-positional `run()` with
 * `subCommands`:
 *   - first token matches a subcommand keyword → descend into it ONLY.
 *   - otherwise, if the node has a `run()` → execute the bare form ONLY.
 *   - otherwise (pure group, unknown token) → usage error, exit 2.
 *
 * The resolved leaf is then executed via citty's `runCommand` on a clone with
 * `subCommands` removed, so citty's buggy descent never fires again. citty's
 * arg parsing (positionals, flags, types) is reused unchanged.
 *
 * DO NOT collapse this back into a plain `runMain(main)` call: the bare-form
 * UX (`connect <slug>`, `profile <url>`, `message <chat> "text"`) depends on
 * this pre-dispatch, and citty 0.1.6 cannot express it natively.
 */

import { runCommand, type CommandDef } from "citty";
import { STDIN_SENTINEL } from "./lib/stdin.js";

type AnyCommand = CommandDef;

/** Resolve a possibly-lazy citty value (subCommands entry, args, meta). */
async function resolveValue<T>(input: T | (() => T) | (() => Promise<T>)): Promise<T> {
  return typeof input === "function" ? (input as () => T | Promise<T>)() : input;
}

/** Index of the first token that is not a flag (does not start with "-"). */
function firstPositionalIndex(rawArgs: string[]): number {
  return rawArgs.findIndex((a) => !a.startsWith("-"));
}

/**
 * Whether a node declares at least one positional argument — i.e. it accepts a
 * bare intent-shaped form (e.g. `connect <slug>`, `profile <url>`,
 * `message <chat_id> "text"`). Pure groups (account, webhook, …) declare none,
 * so an unrecognized token under them is an unknown-subcommand usage error.
 */
async function nodeHasPositional(cmd: AnyCommand): Promise<boolean> {
  const argsDef = (await resolveValue(cmd.args ?? {})) as Record<
    string,
    { type?: string }
  >;
  return Object.values(argsDef).some((def) => def?.type === "positional");
}

/** Collect the declared argument names for a node (for unknown-flag detection). */
async function declaredArgNames(cmd: AnyCommand): Promise<Set<string>> {
  const names = new Set<string>();
  const argsDef = (await resolveValue(cmd.args ?? {})) as Record<
    string,
    { type?: string; alias?: string | string[] }
  >;
  for (const [name, def] of Object.entries(argsDef)) {
    names.add(name);
    const alias = def?.alias;
    if (typeof alias === "string") names.add(alias);
    else if (Array.isArray(alias)) for (const a of alias) names.add(a);
  }
  return names;
}

/**
 * Validate that every `--flag` / `-x` in rawArgs is a declared argument on the
 * resolved leaf. Unknown flags are a usage error (exit 2) per the CLI contract.
 * Returns the offending flag token, or null if all flags are known.
 *
 * citty's own parser silently accepts unknown flags, so this check is the CLI
 * layer's responsibility.
 */
function findUnknownFlag(rawArgs: string[], declared: Set<string>): string | null {
  let afterDoubleDash = false;
  for (const arg of rawArgs) {
    if (afterDoubleDash) continue;
    if (arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!arg.startsWith("-")) continue;
    // Strip leading dashes and any "=value" / "no-" prefix to get the flag name.
    let name = arg.replace(/^-+/, "");
    const eq = name.indexOf("=");
    if (eq !== -1) name = name.slice(0, eq);
    if (name.startsWith("no-")) name = name.slice(3);
    if (name === "") continue; // bare "--" already handled
    if (!declared.has(name)) return arg;
  }
  return null;
}

/** Whether `--fields ""` (empty projection) was passed — a usage error. */
function hasEmptyFields(rawArgs: string[]): boolean {
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--fields") {
      // Empty when the next token is missing, another flag, or the literal "".
      const next = rawArgs[i + 1];
      if (next === undefined || next.startsWith("-")) return true;
      if (next.trim() === "") return true;
    } else if (arg?.startsWith("--fields=")) {
      if (arg.slice("--fields=".length).trim() === "") return true;
    }
  }
  return false;
}

/** Emit a usage diagnostic to stderr and exit 2 (CLI-side usage error). */
function usageError(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.stderr.write("Run `curviate --help` for usage.\n");
  process.exit(2);
}

/**
 * Resolve a node + remaining args down to the single command to execute,
 * descending through matching subcommand keywords. Returns the leaf to run and
 * the rawArgs that belong to it. On an unrecognized token under a pure group
 * (no bare `run`), emits a usage error and exits 2.
 */
async function resolveLeaf(
  cmd: AnyCommand,
  rawArgs: string[],
): Promise<{ leaf: AnyCommand; leafArgs: string[] }> {
  const subCommands = (await resolveValue(cmd.subCommands)) as
    | Record<string, unknown>
    | undefined;

  if (subCommands && Object.keys(subCommands).length > 0) {
    const idx = firstPositionalIndex(rawArgs);
    const token = idx === -1 ? undefined : rawArgs[idx];
    const hasBarePositional = await nodeHasPositional(cmd);

    if (token !== undefined && subCommands[token]) {
      // Token is a known subcommand keyword → descend into it ONLY.
      const sub = (await resolveValue(subCommands[token])) as AnyCommand;
      return resolveLeaf(sub, rawArgs.slice(idx + 1));
    }

    if (token !== undefined && hasBarePositional) {
      // No keyword match but the node accepts a bare positional → run it.
      return { leaf: cmd, leafArgs: rawArgs };
    }

    // No bare-positional intent. A token here is an unknown subcommand keyword.
    if (token !== undefined) {
      usageError(`unknown command \`${token}\``);
    }
    // No token at all → no subcommand specified. Run the node's handler (group
    // nodes print their usage block; the root's no-op falls through to help).
    return { leaf: cmd, leafArgs: rawArgs };
  }

  // Leaf node (no subcommands).
  return { leaf: cmd, leafArgs: rawArgs };
}

/**
 * Run the root command against rawArgs, applying the citty-0.1.6 workarounds
 * described in the file header. Mirrors citty's `runMain` for the help/version
 * fast-paths, then routes through `resolveLeaf`.
 */
export async function dispatch(root: AnyCommand, rawArgs: string[]): Promise<void> {
  // --help / -h : delegate to citty's renderer (exit 0). Resolve the deepest
  // matching node so `curviate profile me --help` shows the right usage.
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    const { showUsage, runMain } = await import("citty");
    // runMain handles --help by resolving the subcommand and printing usage.
    // We only borrow its help path; routing is ours.
    void showUsage;
    await runMain(root, { rawArgs });
    return;
  }

  if (rawArgs.length === 1 && rawArgs[0] === "--version") {
    const meta = (await resolveValue(root.meta ?? {})) as { version?: string };
    if (meta.version) {
      process.stdout.write(meta.version + "\n");
    }
    process.exit(0);
  }

  try {
    const { leaf, leafArgs } = await resolveLeaf(root, rawArgs);

    // CLI-side usage validation on the resolved leaf, BEFORE any handler runs
    // (so a bad projection / unknown flag never reaches the SDK).
    if (hasEmptyFields(leafArgs)) {
      usageError("--fields must not be empty.");
    }
    const declared = await declaredArgNames(leaf);
    const unknown = findUnknownFlag(leafArgs, declared);
    if (unknown !== null) {
      usageError(`unknown flag \`${unknown}\`.`);
    }

    // Pre-process: replace bare "-" with the stdin sentinel before handing to
    // citty/mri. mri's embedded parser (j-dash-count loop) silently swallows "-"
    // — one leading dash gives j=1 → flag branch → empty name → 0-char iteration
    // → never lands in `_[]` → citty cannot bind it to a positional. The sentinel
    // starts with "_" (no leading dash) so mri treats it as a plain positional;
    // resolveTextOrStdin then recognises both "-" and the sentinel.
    const processedLeafArgs = leafArgs.map((a) => (a === "-" ? STDIN_SENTINEL : a));

    // Execute the resolved leaf with subCommands stripped so citty does not
    // re-trigger its buggy descent (misroute / double-run).
    const leafToRun: AnyCommand = { ...leaf, subCommands: undefined };
    await runCommand(leafToRun, { rawArgs: processedLeafArgs });
  } catch (err: unknown) {
    // citty raises a CLIError with code "EARG" for a missing required argument
    // or positional — that is a usage error → exit 2. Anything else thrown here
    // is genuinely unexpected (handlers exit on their own error paths) → exit 1.
    // Either way, write a plain diagnostic without the framework's usage bleed;
    // routing errors already exited 2 above.
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code;
    process.stderr.write(`error: ${message}\n`);
    process.exit(code === "EARG" ? 2 : 1);
  }
}
