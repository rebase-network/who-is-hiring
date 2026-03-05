import {
  buildIndex,
  buildJobDetailPage,
  buildRobots,
  buildSitemap,
  jobDetailPath,
  pickMeaningfulParagraph,
  selectDisplaySummary,
} from "../src/site.js";

describe("site helpers", () => {
  it("creates stable internal detail paths", () => {
    expect(jobDetailPath(123)).toBe("jobs/123.html");
  });

  it("uses raw body fallback when summary is too short", () => {
    const summary = selectDisplaySummary("short", "Company: ACME\n\nBuild mission-critical systems at scale.");
    expect(summary).toContain("Build mission-critical systems");
  });

  it("skips heading-only paragraphs for fallback excerpts", () => {
    const paragraph = pickMeaningfulParagraph("Company: ACME\n\nLocation: Remote\n\nWe need engineers to own backend services.");
    expect(paragraph).toBe("We need engineers to own backend services.");
  });
});

describe("site rendering", () => {
  const row = {
    id: 1,
    number: 1068,
    url: "https://github.com/rebase-network/who-is-hiring/issues/1068",
    title: "[Remote] Venturelabs is hiring a Community Manager",
    company: "Venturelabs",
    location: "Remote",
    salary: "$4,000 - $5,000",
    remote: true,
    labels: ["jobs"],
    summary: "Venturelabs is an early-stage venture capital fund.",
    raw_body: [
      "About Venturelabs",
      "",
      "Venturelabs supports builders of Web3 and crypto infrastructure.",
      "",
      "Role Overview",
      "",
      "You will shape the voice of Venturelabs in public channels.",
      "",
      "Requirements",
      "",
      "2+ years of Web3 community operations experience.",
    ].join("\n"),
    completeness_score: 80,
    completeness_grade: "B" as const,
    missing_fields: ["responsibilities"],
    contact_channels: ["email:jobs@example.com"],
    timezone: "UTC+8",
    employment_type: "Full-time",
    responsibilities: "Grow and engage community channels.",
    created_at: "2026-03-05T14:00:00.000Z",
  };

  it("renders Chinese list shell with SEO tags", () => {
    const html = buildIndex([row], "rebase-network/who-is-hiring", "https://rebase-network.github.io/who-is-hiring");
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain("加载更多职位");
    expect(html).toContain('fetch(\'jobs.normalized.json\')');
    expect(html).toContain('property="og:title" content="谁在招聘 Who Is Hiring - 职位列表"');
    expect(html).toContain('property="og:site_name" content="谁在招聘 Who Is Hiring"');
    expect(html).toContain('rel="canonical" href="https://rebase-network.github.io/who-is-hiring/index.html"');
  });

  it("renders Chinese detail page with JobPosting data", () => {
    const html = buildJobDetailPage(row, "rebase-network/who-is-hiring", "https://rebase-network.github.io/who-is-hiring");
    expect(html).toContain("完整度元数据");
    expect(html).toContain("谁在招聘 Who Is Hiring");
    expect(html).toContain("职位概述");
    expect(html).toContain("任职要求");
    expect(html).toContain("查看原始 GitHub Issue");
    expect(html).toContain('"@type":"JobPosting"');
    expect(html).toContain('property="article:published_time" content="2026-03-05T14:00:00.000Z"');
  });

  it("renders sitemap and robots with canonical host", () => {
    const sitemap = buildSitemap([row], "https://rebase-network.github.io/who-is-hiring");
    const robots = buildRobots("https://rebase-network.github.io/who-is-hiring");
    expect(sitemap).toContain("https://rebase-network.github.io/who-is-hiring/index.html");
    expect(sitemap).toContain("https://rebase-network.github.io/who-is-hiring/jobs/1068.html");
    expect(robots).toContain("Sitemap: https://rebase-network.github.io/who-is-hiring/sitemap.xml");
  });
});
