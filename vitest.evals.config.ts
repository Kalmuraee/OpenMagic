import { defineConfig } from "vitest/config";

// Eval suite runs separately from unit tests (npm run eval). It exercises the
// real grounding → patch pipeline against fixture projects to score ESR.
export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
  },
});
