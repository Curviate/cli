import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "es2020",
  clean: true,
  dts: false,
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
