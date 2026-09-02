import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const apiSrc = fileURLToPath(new URL("../apps/api/src", import.meta.url));

/**
 * Tests import backend modules through the `@api/*` alias rather than through
 * the package's `exports` map, so QA is not coupled to how apps/api chooses to
 * expose its internals. The alias points straight at the agreed module paths
 * from docs/MODULE_MAP.md.
 */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@api\//, replacement: `${apiSrc}/` }],
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Workspace packages ship raw TS; make sure Vite transforms them.
    server: { deps: { inline: [/@finance-demo\//] } },
  },
});
