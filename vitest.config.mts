import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

// Two projects:
//   node  — `*.test.ts`  (server code, pure functions, route handlers)
//   dom   — `*.test.tsx` (React components, jsdom)
// Both share the `@/*` → `src/*` alias and the env/test setup.
export default defineConfig({
  resolve: {
    alias: { "@": src },
  },
  test: {
    passWithNoTests: true,
    // CSS Modules keep their source class names in tests (e.g. `late`, `work`),
    // so component tests can assert on `className` without hashes.
    css: { modules: { classNameStrategy: "non-scoped" } },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts", "./vitest.setup.dom.ts"],
        },
      },
    ],
  },
});
