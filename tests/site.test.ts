import {
  buildIndex,
  buildJobDetailPage,
  buildRobots,
  buildRssFeed,
  buildSitemap,
  jobDetailPath,
  pickMeaningfulParagraph,
  selectDisplaySummary,
} from "../src/site.js";

describe("site helpers", () => {
  it("creates stable internal detail paths", () => {
    expect(jobDetailPath(123)).toBe("jobs/123.html");
  });

  it("returns trimmed summary", () => {
    const summary = selectDisplaySummary(" short summary ");
    expect(summary).toBe("short summary");
  });

  it("skips heading-only paragraphs for fallback excerpts", () => {
    const paragraph = pickMeaningfulParagraph("Company: ACME\n\nLocation: Remote\n\nWe need engineers to own backend services.");
    expect(paragraph).toBe("We need engineers to own backend services.");
  });
});

describe("site rendering", () => {
  const listRow = {
    number: 1068,
    title: "[Remote] Venturelabs is hiring a Community Manager",
    company: "Venturelabs",
    location: "Remote",
    salary: "$4,000 - $5,000",
    remote: true,
    summary: "Venturelabs is an early-stage venture capital fund.",
    completeness_score: 80,
    completeness_grade: "B" as const,
    missing_fields: ["responsibilities"],
    contact_channels: ["email:jobs@example.com"],
    timezone: "UTC+8",
    employment_type: "Full-time",
    created_at: "2026-03-05T14:00:00.000Z",
    updated_at: "2026-03-07T09:30:00.000Z",
  };

  const detailRow = {
    ...listRow,
    url: "https://github.com/rebase-network/who-is-hiring/issues/1068",
    labels: ["jobs"],
    narrative: [
      "Venturelabs supports builders of Web3 and crypto infrastructure.",
      "You will shape the voice of Venturelabs in public channels and coordinate with founders.",
    ],
    responsibilities: ["Grow and engage community channels.", "Own strategy execution on social platforms."],
    requirements: ["2+ years of Web3 community operations experience."],
    compensation_notes: ["Monthly salary: $4,000 - $5,000"],
    contact_details: ["email:jobs@example.com", "telegram:@venturelabs"],
    sections: [
      {
        title: "Role Overview",
        paragraphs: ["You will represent Venturelabs across Web3 communities."],
        bullets: ["Coordinate with investment and portfolio teams"],
      },
    ],
  };

  it("renders Chinese list shell with SEO tags", () => {
    const html = buildIndex([listRow], "rebase-network/who-is-hiring", "https://hire.rebase.network");
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain("加载更多职位");
    expect(html).toContain("fetch('jobs.normalized.json')");
    expect(html).toContain('property="og:title" content="谁在招聘 Who Is Hiring - 职位列表"');
    expect(html).toContain('property="og:site_name" content="谁在招聘 Who Is Hiring"');
    expect(html).toContain('rel="canonical" href="https://hire.rebase.network/index.html"');
    expect(html).toContain('rel="alternate" type="application/rss+xml"');
    expect(html).toContain('https://hire.rebase.network/feed.xml');
    expect(html).toContain('支持通过 RSS 订阅最新开放岗位');
  });

  it("renders rich detail page sections with JobPosting data", () => {
    const html = buildJobDetailPage(detailRow, "rebase-network/who-is-hiring", "https://hire.rebase.network");
    expect(html).toContain("完整度元数据");
    expect(html).toContain("谁在招聘 Who Is Hiring");
    expect(html).toContain("职位概述");
    expect(html).toContain("任职要求");
    expect(html).toContain("薪酬说明");
    expect(html).toContain("Role Overview");
    expect(html).toContain("查看原始 GitHub Issue");
    expect(html).toContain('"@type":"JobPosting"');
    expect(html).toContain('property="article:published_time" content="2026-03-05T14:00:00.000Z"');
  });

  it("renders sitemap and robots with canonical host", () => {
    const sitemap = buildSitemap([listRow], "https://hire.rebase.network");
    const robots = buildRobots("https://hire.rebase.network");
    expect(sitemap).toContain("https://hire.rebase.network/index.html");
    expect(sitemap).toContain("https://hire.rebase.network/jobs/1068.html");
    expect(robots).toContain("Sitemap: https://hire.rebase.network/sitemap.xml");
  });

  it("renders an RSS feed for open jobs", () => {
    const feed = buildRssFeed([listRow], "rebase-network/who-is-hiring", "https://hire.rebase.network", "2026-03-10T08:00:00.000Z");
    expect(feed).toContain('<rss version="2.0"');
    expect(feed).toContain("<title>谁在招聘 Who Is Hiring</title>");
    expect(feed).toContain("https://hire.rebase.network/feed.xml");
    expect(feed).toContain("https://hire.rebase.network/jobs/1068.html");
    expect(feed).toContain("Venturelabs is an early-stage venture capital fund.");
    expect(feed).toContain("Sat, 07 Mar 2026 09:30:00 GMT");
    expect(feed).toContain("Tue, 10 Mar 2026 08:00:00 GMT");
  });
});
