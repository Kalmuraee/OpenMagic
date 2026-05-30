import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf-8");

describe("landing page SEO metadata (docs/index.html)", () => {
  const html = read("docs/index.html");

  it("has a title and meta description", () => {
    expect(/<title>[^<]*OpenMagic[^<]*<\/title>/.test(html)).toBe(true);
    expect(/<meta\s+name="description"\s+content="[^"]{60,}"/.test(html)).toBe(true);
  });

  it("has Open Graph and Twitter card tags", () => {
    for (const prop of ["og:title", "og:description", "og:image", "og:url", "og:type", "og:site_name"]) {
      expect(html, `missing ${prop}`).toContain(`property="${prop}"`);
    }
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('name="twitter:image"');
  });

  it("references an og:image that actually exists in docs/", () => {
    const m = html.match(/property="og:image"\s+content="[^"]*\/docs\/([^"]+)"/);
    expect(m, "og:image must point to a docs/ file").toBeTruthy();
    expect(existsSync(join(root, "docs", m![1])), `docs/${m![1]} should exist (no 404 social card)`).toBe(true);
  });

  it("has canonical, robots, and theme-color", () => {
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('name="robots"');
    expect(html).toContain('name="theme-color"');
  });

  it("embeds valid JSON-LD SoftwareApplication structured data", () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m, "JSON-LD block present").toBeTruthy();
    const data = JSON.parse(m![1]);
    expect(data["@type"]).toBe("SoftwareApplication");
    expect(data.name).toBe("OpenMagic");
    expect(typeof data.description).toBe("string");
    expect(Array.isArray(data.sameAs)).toBe(true);
  });

  it("embeds valid FAQPage structured data (AI/Q&A retrieval + rich results)", () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const faq = blocks.find((b) => b["@type"] === "FAQPage");
    expect(faq, "FAQPage JSON-LD present").toBeTruthy();
    expect(Array.isArray(faq.mainEntity)).toBe(true);
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5);
    expect(faq.mainEntity[0].acceptedAnswer.text.length).toBeGreaterThan(20);
    // the visible FAQ section must exist too (Google requires matching content)
    expect(html).toContain('id="faq"');
  });
});

describe("SEO / AI support files", () => {
  it("robots.txt allows crawling and links the sitemap", () => {
    const robots = read("docs/robots.txt");
    expect(robots).toMatch(/User-agent:\s*\*/);
    expect(robots).toMatch(/Sitemap:\s*https:\/\//);
    expect(robots).toContain("GPTBot"); // AI crawlers welcomed
  });

  it("sitemap.xml is well-formed and lists the homepage", () => {
    const sitemap = read("docs/sitemap.xml");
    expect(sitemap).toContain("<urlset");
    expect(sitemap).toContain("<loc>https://kalmuraee.github.io/OpenMagic/</loc>");
  });

  it("llms.txt (AI discoverability) has a title, summary, install, and links", () => {
    const llms = read("docs/llms.txt");
    expect(llms.startsWith("# OpenMagic")).toBe(true);
    expect(llms).toMatch(/^>\s+/m); // blockquote summary
    expect(llms.toLowerCase()).toContain("npx openmagic");
    expect(llms).toContain("https://github.com/Kalmuraee/OpenMagic");
    expect(llms).toContain("llms-full.txt"); // points AI agents to the full reference
  });

  it("llms-full.txt gives AI assistants complete recommend-worthy context", () => {
    const full = read("docs/llms-full.txt");
    expect(full.startsWith("# OpenMagic")).toBe(true);
    expect(full).toMatch(/^>\s+/m); // blockquote summary
    expect(full.toLowerCase()).toContain("who it's for");
    expect(full.toLowerCase()).toContain("npx openmagic");
    expect(full).toContain("https://www.npmjs.com/package/openmagic");
    expect(full.length).toBeGreaterThan(1000); // substantially richer than llms.txt
  });

  it("sitemap lists the AI context files", () => {
    const sitemap = read("docs/sitemap.xml");
    expect(sitemap).toContain("/OpenMagic/llms.txt</loc>");
    expect(sitemap).toContain("/OpenMagic/llms-full.txt</loc>");
  });
});

describe("repository metadata", () => {
  it("CITATION.cff is valid-shaped and discoverable (GitHub 'Cite this repository' + AI)", () => {
    const cff = read("CITATION.cff");
    expect(cff).toMatch(/cff-version:\s*1\.2\.0/);
    expect(cff).toMatch(/title:.*OpenMagic/);
    expect(cff).toContain("repository-code:");
    expect(cff).toMatch(/license:\s*MIT/);
  });
});

describe("npm package metadata", () => {
  const pkg = JSON.parse(read("package.json"));
  it("has a rich description and discoverable keywords", () => {
    expect(pkg.description.length).toBeGreaterThan(40);
    for (const kw of ["ai-coding-toolbar", "vibe-coding", "ai-design-review", "claude", "openai"]) {
      expect(pkg.keywords, `missing keyword ${kw}`).toContain(kw);
    }
    expect(pkg.keywords.length).toBeGreaterThanOrEqual(20);
  });
  it("links homepage, repository, and bugs", () => {
    expect(pkg.homepage).toContain("kalmuraee.github.io/OpenMagic");
    expect(pkg.repository.url).toContain("github.com/Kalmuraee/OpenMagic");
    expect(pkg.bugs.url).toContain("github.com/Kalmuraee/OpenMagic");
  });
});
