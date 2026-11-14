import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts", "tools/**/*.test.ts"],
    environment: "node",
    coverage: { provider: "v8", include: ["src/core/**", "src/inputs/**", "server/**", "tools/world/**"] },
  },
});
