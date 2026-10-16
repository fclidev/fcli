import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// src/ uses the ESM-TS convention of importing "./x.js" for x.ts. Alias the
// known modules explicitly so vitest (vite) resolves them.
function tsAlias(local: string) {
  const abs = resolve(here, "src", local);
  return existsSync(abs) ? abs : undefined;
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.{js,ts,mjs}"],
  },
  resolve: {
    alias: [
      { find: /^\.\.\/src\/types\.js$/, replacement: tsAlias("types.ts") },
      { find: /^\.\.\/src\/registry\.js$/, replacement: tsAlias("registry.ts") },
      { find: /^\.\.\/src\/store\.js$/, replacement: tsAlias("store.ts") },
      { find: /^\.\.\/src\/config\.js$/, replacement: tsAlias("config.ts") },
      { find: /^\.\.\/src\/cli\.js$/, replacement: tsAlias("cli.ts") },
      { find: /^\.\.\/src\/help\.js$/, replacement: tsAlias("help.ts") },
      { find: /^\.\.\/src\/update\.js$/, replacement: tsAlias("update.ts") },
    ],
  },
});
