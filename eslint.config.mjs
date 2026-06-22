// ESLint flat config for @curviate/cli.
// Keeps TypeScript-strict hygiene while allowing console.log/console.error —
// the CLI writes to stdout/stderr by design.

import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      // Console is intentional in a CLI — allow all console methods.
      "no-console": "off",
      // Prefer const.
      "prefer-const": "error",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "*.tsbuildinfo", "scripts/"],
  }
);
