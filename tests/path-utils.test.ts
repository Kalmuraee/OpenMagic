import { describe, expect, it } from "vitest";
import { toPortablePath } from "../src/path-utils.js";

describe("toPortablePath", () => {
  it("normalizes Windows repository paths", () => {
    expect(toPortablePath("src\\components\\Hero.tsx")).toBe("src/components/Hero.tsx");
  });

  it("leaves portable paths unchanged", () => {
    expect(toPortablePath("src/components/Hero.tsx")).toBe("src/components/Hero.tsx");
  });
});
