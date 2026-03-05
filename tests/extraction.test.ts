import { afterEach, describe, expect, it, vi } from "vitest";
import { assessIssueConfidence, enrichLowConfidenceRecords } from "../src/extraction.js";
import type { NormalizedJob, RichJob } from "../src/schemas.js";

function makeRich(overrides: Partial<RichJob> = {}): RichJob {
  return {
    id: 1,
    number: 1,
    url: "https://github.com/rebase-network/who-is-hiring/issues/1",
    title: "[Remote] ACME hiring backend engineer",
    state: "open",
    labels: ["jobs"],
    created_at: "2026-03-05T00:00:00Z",
    updated_at: "2026-03-05T00:00:00Z",
    closed_at: null,
    author: "alice",
    company: "ACME",
    location: "Singapore",
    salary: "5000-7000 USD / month",
    salary_min: 5000,
    salary_max: 7000,
    salary_currency: "USD",
    salary_period: "month",
    remote: true,
    work_mode: "Remote",
    timezone: "UTC+8",
    employment_type: "Full-time",
    summary: "ACME is hiring a backend engineer to build reliable data infra.",
    responsibilities: ["Build systems"],
    requirements: [],
    compensation_notes: [],
    contact_details: ["email:jobs@acme.dev"],
    sections: [],
    narrative: [],
    raw_body: "Company: ACME\nLocation: Singapore\nSalary: 5000-7000 USD / month",
    completeness_score: 100,
    completeness_grade: "A",
    missing_fields: [],
    ...overrides,
  };
}

function makeNormalized(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 1,
    number: 1,
    url: "https://github.com/rebase-network/who-is-hiring/issues/1",
    title: "[Remote] ACME hiring backend engineer",
    company: "ACME",
    location: "Singapore",
    salary: "5000-7000 USD / month",
    salary_min: 5000,
    salary_max: 7000,
    salary_currency: "USD",
    salary_period: "month",
    remote: true,
    work_mode: "Remote",
    timezone: "UTC+8",
    employment_type: "Full-time",
    responsibilities: "Build systems",
    contact_channels: ["email:jobs@acme.dev"],
    completeness_score: 100,
    completeness_grade: "A",
    missing_fields: [],
    state: "open",
    labels: ["jobs"],
    created_at: "2026-03-05T00:00:00Z",
    updated_at: "2026-03-05T00:00:00Z",
    closed_at: null,
    summary: "ACME is hiring a backend engineer to build reliable data infra.",
    author: "alice",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LLM_API_KEY;
});

describe("assessIssueConfidence", () => {
  it("flags missing fields and conflicts as low confidence", () => {
    const rich = makeRich({
      company: null,
      location: null,
      salary: "30k-40k USD and 20k-25k CNY",
      contact_details: [],
      responsibilities: [],
      summary: "Short",
      compensation_notes: ["Compensation: 30k-40k USD", "薪资: 20k-25k CNY"],
      raw_body: "Company: Foo\nCompany: Bar\nLocation: Singapore\nLocation: HK",
    });

    const result = assessIssueConfidence(rich, 70);
    expect(result.lowConfidence).toBe(true);
    expect(result.score).toBeLessThan(70);
    expect(result.reasons).toContain("missing-company");
    expect(result.reasons).toContain("conflicting-salary-signals");
    expect(result.conflicts).toContain("company-multiple-labeled-values");
    expect(result.conflicts).toContain("location-multiple-labeled-values");
  });
});

describe("enrichLowConfidenceRecords", () => {
  it("does not merge sentence-like company names from llm", async () => {
    process.env.LLM_API_KEY = "test-key";

    const rich = makeRich({ number: 12, company: null, summary: "short", responsibilities: [], contact_details: [] });
    const norm = makeNormalized({ number: 12, company: null, summary: "short", responsibilities: null, contact_channels: [] });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            records: [
              {
                number: 12,
                company: "负责领导和指导下属团队，确保其达到预定的目标和任务。",
              },
            ],
          }),
        }),
      }),
    );

    const result = await enrichLowConfidenceRecords({
      normalized: [norm],
      rich: [rich],
      lowConfidenceThreshold: 100,
    });

    expect(result.records[0]?.company).toBeNull();
  });

  it("attempts llm for all issues and merges conservatively", async () => {
    process.env.LLM_API_KEY = "test-key";

    const lowRich = makeRich({
      number: 2,
      company: null,
      location: null,
      salary: null,
      contact_details: [],
      responsibilities: [],
      summary: "short",
      raw_body: "Company: Foo Labs\nLocation: Tokyo\nSalary: 7000-9000 USD / month\nContact: hr@foo.dev",
      completeness_score: 20,
      completeness_grade: "F",
      missing_fields: ["company", "location", "salary", "responsibilities", "contact"],
    });

    const highRich = makeRich({ number: 3, company: "Stable Inc", location: "HK", salary: "5000-7000 USD / month" });
    const lowNorm = makeNormalized({
      number: 2,
      company: null,
      location: null,
      salary: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      responsibilities: null,
      contact_channels: [],
      summary: "short",
      completeness_score: 20,
      completeness_grade: "F",
      missing_fields: ["company", "location", "salary", "responsibilities", "contact"],
    });
    const highNorm = makeNormalized({ number: 3, company: "Stable Inc", location: "HK", salary: "5000-7000 USD / month" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            records: [
              {
                number: 2,
                company: "Foo Labs",
                location: "Tokyo",
                salary: "7000-9000 USD / month",
                salary_min: 7000,
                salary_max: 9000,
                salary_currency: "USD",
                salary_period: "month",
                responsibilities: "Build APIs",
                contact_channels: ["email:hr@foo.dev"],
                summary: "Foo Labs is hiring an API engineer to scale backend systems.",
              },
              {
                number: 3,
                company: "Stable Inc",
              },
            ],
          }),
        }),
      }),
    );

    const result = await enrichLowConfidenceRecords({
      normalized: [lowNorm, highNorm],
      rich: [lowRich, highRich],
      lowConfidenceThreshold: 70,
    });

    const low = result.records.find((r) => r.number === 2);
    const high = result.records.find((r) => r.number === 3);
    expect(low?.company).toBe("Foo Labs");
    expect(low?.salary_min).toBe(7000);
    expect(low?.contact_channels).toContain("email:hr@foo.dev");
    expect(high?.company).toBe("Stable Inc");

    const lowTrace = result.traces.find((t) => t.number === 2);
    const highTrace = result.traces.find((t) => t.number === 3);
    expect(lowTrace?.route).toBe("llm-enriched");
    expect(lowTrace?.llm_result).toBe("applied");
    expect(highTrace?.llm_attempted).toBe(true);
    expect(highTrace?.route).toBe("llm-fallback");
    expect(highTrace?.fallback_reason).toBe("no-safe-fields-to-merge");
  });

  it("keeps deterministic output when llm fails", async () => {
    process.env.LLM_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    const lowRich = makeRich({
      company: null,
      location: null,
      salary: null,
      contact_details: [],
      responsibilities: [],
      summary: "short",
    });
    const lowNorm = makeNormalized({
      company: null,
      location: null,
      salary: null,
      responsibilities: null,
      contact_channels: [],
      summary: "short",
      completeness_score: 20,
      completeness_grade: "F",
      missing_fields: ["company", "location", "salary", "responsibilities", "contact"],
    });

    const result = await enrichLowConfidenceRecords({
      normalized: [lowNorm],
      rich: [lowRich],
      lowConfidenceThreshold: 90,
    });

    expect(result.records[0]).toEqual(lowNorm);
    expect(result.traces[0]?.route).toBe("llm-fallback");
    expect(result.traces[0]?.llm_error).toBe("llm-http-500");
    expect(result.traces[0]?.fallback_reason).toBe("llm-http-500");
  });

  it("falls back deterministically when llm key is unavailable", async () => {
    const rich = makeRich({ number: 10, company: null, summary: "short", responsibilities: [], contact_details: [] });
    const norm = makeNormalized({ number: 10, company: null, summary: "short", responsibilities: null, contact_channels: [] });

    const result = await enrichLowConfidenceRecords({
      normalized: [norm],
      rich: [rich],
    });

    expect(result.records[0]).toEqual(norm);
    expect(result.traces[0]?.llm_attempted).toBe(false);
    expect(result.traces[0]?.route).toBe("llm-fallback");
    expect(result.traces[0]?.fallback_reason).toBe("missing-api-key");
  });

  it("falls back deterministically when llm returns invalid json", async () => {
    process.env.LLM_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ output_text: "not-json" }),
      }),
    );

    const rich = makeRich({ number: 11, company: null, summary: "short", responsibilities: [], contact_details: [] });
    const norm = makeNormalized({ number: 11, company: null, summary: "short", responsibilities: null, contact_channels: [] });

    const result = await enrichLowConfidenceRecords({
      normalized: [norm],
      rich: [rich],
    });

    expect(result.records[0]).toEqual(norm);
    expect(result.traces[0]?.llm_attempted).toBe(true);
    expect(result.traces[0]?.route).toBe("llm-fallback");
    expect(result.traces[0]?.fallback_reason).toBe("llm-invalid-json");
  });
});
