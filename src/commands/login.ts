/**
 * `curviate login` — write or update an API key profile.
 *
 * Interactive mode (TTY, no --api-key): prompts for the key with masked
 * input (not echoed), then writes to the named profile.
 *
 * Non-interactive mode (--api-key <key>, or --api-key - to read from stdin):
 * writes without prompting. The key never appears in argv when read from stdin.
 *
 * A blank/empty key is rejected before any write (exit 2).
 *
 * No network call is made — the key is saved as-is; the first real command
 * verifies it against the API.
 */

import { defineCommand } from "citty";
import { writeProfile } from "../lib/config.js";
import { GLOBAL_FLAGS } from "../lib/global-flags.js";
import { readlineSync } from "../lib/readline.js";

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description:
      "Save an API key to a local profile. Run `curviate profile me` to verify.",
  },
  args: {
    ...GLOBAL_FLAGS,
    "api-key": {
      type: "string",
      description:
        'API key to save. Pass "-" to read from stdin (keeps the key off argv).',
    },
    account: {
      type: "string",
      description: "Default account id to store with this profile.",
    },
    profile: {
      type: "string",
      description: "Profile name to write to (default: default).",
      default: "default",
    },
  },
  async run({ args }) {
    const profileName = (args.profile as string | undefined) ?? "default";
    let apiKey = (args["api-key"] as string | undefined);

    // --api-key - means: read from stdin.
    if (apiKey === "-") {
      apiKey = await readStdin();
    }

    // If no --api-key and we have a TTY, prompt interactively.
    if (apiKey === undefined) {
      if (process.stdin.isTTY) {
        apiKey = await promptMasked("Enter your API key: ");
      } else {
        process.stderr.write(
          "error: no API key — pass --api-key or run interactively on a TTY.\n",
        );
        process.exit(2);
      }
    }

    // Validate: blank key is rejected.
    apiKey = apiKey.trim();
    if (!apiKey) {
      process.stderr.write("error: API key must not be empty.\n");
      process.exit(2);
    }

    const account = (args.account as string | undefined) ?? undefined;

    await writeProfile(profileName, { apiKey, account });

    // Confirmation to stderr only — key is never echoed.
    process.stderr.write(
      `Saved to profile "${profileName}". Run \`curviate profile me\` to verify.\n`,
    );
  },
});

/** Read a line from stdin (used for --api-key -). */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8").trim());
    });
    process.stdin.on("error", reject);
  });
}

/**
 * Prompt for masked (not echoed) input.
 * Uses readline with setRawMode when available for mask-on-TTY behavior.
 */
async function promptMasked(prompt: string): Promise<string> {
  return readlineSync(prompt, { mask: true });
}
