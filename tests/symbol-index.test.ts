import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSymbolIndex, findSymbol } from "../src/symbol-index.js";

const ROOT = join(process.cwd(), ".test-symbol-root");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "src/components"), { recursive: true });
  writeFileSync(join(ROOT, "package.json"), JSON.stringify({ name: "t" }));
  writeFileSync(join(ROOT, "src/components/Hero.tsx"), "export function Hero() {\n  return <section />;\n}\n");
  writeFileSync(join(ROOT, "src/utils.ts"),
    "export const formatPrice = (n: number) => `$${n}`;\nexport function calcTotal() { return 0; }\nexport default class ApiClient {}\n");
  writeFileSync(join(ROOT, "src/types.ts"), "export interface User { id: string }\nexport type Id = string;\n");
});
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe("buildSymbolIndex", () => {
  it("indexes an exported component by name and marks it a component", () => {
    const index = buildSymbolIndex(ROOT, [ROOT]);
    const hero = findSymbol(index, "Hero");
    expect(hero.length).toBe(1);
    expect(hero[0].file).toBe("src/components/Hero.tsx");
    expect(hero[0].kind).toBe("component");
  });

  it("indexes const, function, and default-class exports", () => {
    const index = buildSymbolIndex(ROOT, [ROOT]);
    expect(findSymbol(index, "formatPrice")[0]).toMatchObject({ file: "src/utils.ts", kind: "const" });
    expect(findSymbol(index, "calcTotal")[0]).toMatchObject({ file: "src/utils.ts", kind: "function" });
    expect(findSymbol(index, "ApiClient")[0]).toMatchObject({ file: "src/utils.ts", kind: "class" });
  });

  it("indexes interface and type exports", () => {
    const index = buildSymbolIndex(ROOT, [ROOT]);
    expect(findSymbol(index, "User")[0]).toMatchObject({ file: "src/types.ts", kind: "interface" });
    expect(findSymbol(index, "Id")[0]).toMatchObject({ file: "src/types.ts", kind: "type" });
  });

  it("looks up symbols case-insensitively", () => {
    const index = buildSymbolIndex(ROOT, [ROOT]);
    expect(findSymbol(index, "hero").length).toBe(1);
    expect(findSymbol(index, "HERO").length).toBe(1);
  });

  it("returns an empty array for unknown symbols", () => {
    const index = buildSymbolIndex(ROOT, [ROOT]);
    expect(findSymbol(index, "Nonexistent")).toEqual([]);
  });
});
