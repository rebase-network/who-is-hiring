import { issueToNormalized, parseIssueText } from "../src/parser.js";

describe("parseIssueText", () => {
  it("extracts known fields", () => {
    const parsed = parseIssueText(
      "[Remote] ACME is hiring Senior Backend Engineer",
      "Company: ACME\nLocation: Singapore\nSalary: 5000-7000 USD\n\nBuild infra",
    );

    expect(parsed.company).toBe("ACME");
    expect(parsed.location).toBe("Singapore");
    expect(parsed.salary).toBe("5000-7000 USD");
    expect(parsed.remote).toBe(true);
    expect(parsed.summary).toBe("Company: ACME\nLocation: Singapore\nSalary: 5000-7000 USD");
  });

  it("guesses location and salary from fallback patterns", () => {
    const parsed = parseIssueText(
      "[HK] Example Co hiring QA Engineer",
      "Onsite: Central\nCompensation: 30000-50000 RMB",
    );

    expect(parsed.location).toBe("HK");
    expect(parsed.salary).toContain("30000-50000");
  });
});

describe("issueToNormalized", () => {
  it("builds the normalized record shape", () => {
    const normalized = issueToNormalized({
      id: 1,
      number: 10,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/10",
      title: "[HK] Example Co hiring QA Engineer",
      body: "Remote: yes\nSalary: 30K-50K RMB",
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-04T10:00:00Z",
      updated_at: "2026-03-04T10:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(normalized.number).toBe(10);
    expect(normalized.labels).toEqual(["jobs"]);
    expect(normalized.author).toBe("alice");
    expect(normalized.remote).toBe(true);
  });
});
