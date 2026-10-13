import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node22",
  clean: true,
  // native modules stay external, everything else (incl. workspace package) is bundled
  external: ["better-sqlite3", "argon2"],
  noExternal: ["@potato-mana/shared"],
});
