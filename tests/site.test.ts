import { buildIndex, buildJobDetailPage, jobDetailPath, pickMeaningfulParagraph, selectDisplaySummary } from "../src/site.js";

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
    raw_body: "Responsibilities:\n- Grow community",
    completeness_score: 80,
    completeness_grade: "B" as const,
    missing_fields: ["responsibilities"],
    contact_channels: ["email:jobs@example.com"],
    timezone: "UTC+8",
    employment_type: "Full-time",
    responsibilities: "Grow and engage community channels.",
  };

  it("renders list shell that fetches jobs JSON", () => {
    const html = buildIndex([row], "rebase-network/who-is-hiring");
    expect(html).toContain("fetch('jobs.normalized.json')");
    expect(html).toContain("jobs/' + row.number + '.html");
  });

  it("renders detail pages with structured sections and source link", () => {
    const html = buildJobDetailPage(row, "rebase-network/who-is-hiring");
    expect(html).toContain("Completeness Metadata");
    expect(html).toContain("Responsibilities");
    expect(html).toContain("Contact");
    expect(html).toContain("View original GitHub issue");
    expect(html).toContain(row.url);
  });
});
