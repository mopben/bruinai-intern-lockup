import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("preloaded second runs", () => {
  it("cannot reach the prediction: frozen.ts, numbers.ts and derive.ts never import them", () => {
    for (const file of ["app/frozen.ts", "app/numbers.ts", "state/derive.ts"]) {
      expect(src(file), file).not.toMatch(/preload/);
    }
  });
});
