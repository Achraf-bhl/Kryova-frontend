import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `.mts` rather than `.ts`: Vite's next-major `configLoader: "native"` loads a
// bare `.ts` config as CommonJS and warned on every single run about the ESM
// syntax in it. That also means no `__dirname` here — the alias is resolved
// from `import.meta.url` instead.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
