import { defineConfig } from "vitest/config";

/**
 * One Vitest config for the whole workspace. Vitest transpiles test files with
 * esbuild, so it runs the TypeScript sources directly -- no `tsc` build step and
 * no dependency on dist/. Type-only imports (like `Op` from @syncforge/shared)
 * are erased before execution, so tests never need a package's runtime output.
 */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});
