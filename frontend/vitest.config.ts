import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    // Default to node; component test files opt into happy-dom via a
    // `// @vitest-environment happy-dom` docblock at the top of the file.
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    // `server-only` throws if imported outside an RSC; stub it for tests.
    alias: {
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url))
    }
  }
});
