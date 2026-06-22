import { defineCommand, runMain } from "citty";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Read version from package.json at runtime (single source of truth).
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require(resolve(__dirname, "../package.json")) as {
  version: string;
  name: string;
};

const main = defineCommand({
  meta: {
    name: "curviate",
    version: pkg.version,
    description: "Official command-line interface for the Curviate API.",
  },
  // Command tree is populated by dev as commands are implemented.
  // Subcommands are lazy-loaded (dynamic import) to keep cold-start fast.
  subCommands: {},
  async run() {
    // Root invocation with no subcommand: print help (citty handles this).
  },
});

runMain(main);
