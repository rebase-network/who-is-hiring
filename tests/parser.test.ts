import { issueToNormalized, parseIssueText } from "../src/parser.js";

describe("parseIssueText", () => {
  it("extracts enriched fields from english issues", () => {
    const parsed = parseIssueText(
      "[Remote/Singapore] ACME is hiring Senior Backend Engineer",
      [
        "Company: ACME Labs",
        "Location: Singapore",
        "Salary: 5,000-7,500 USD / month",
        "Work mode: Remote",
        "Timezone: UTC+8",
        "Employment Type: Full-time",
        "Responsibilities:",
        "- Build and maintain indexer services",
        "- Own API reliability",
        "Contact: jobs@acme.dev, Telegram @acme_hr",
      ].join("\n"),
    );

    expect(parsed.company).toBe("ACME Labs");
    expect(parsed.location).toBe("Singapore");
    expect(parsed.salary).toBe("5,000-7,500 USD / month");
    expect(parsed.salary_min).toBe(5000);
    expect(parsed.salary_max).toBe(7500);
    expect(parsed.salary_currency).toBe("USD");
    expect(parsed.salary_period).toBe("month");
    expect(parsed.remote).toBe(true);
    expect(parsed.work_mode).toBe("Remote");
    expect(parsed.timezone).toBe("UTC+8");
    expect(parsed.employment_type).toBe("Full-time");
    expect(parsed.responsibilities).toContain("Build and maintain indexer services");
    expect(parsed.contact_channels).toContain("email:jobs@acme.dev");
    expect(parsed.contact_channels).toContain("telegram");
  });

  it("handles chinese headings and title fallback extraction", () => {
    const parsed = parseIssueText(
      "[上海/远程] 某公司诚聘 区块链工程师 薪水 25k-40k RMB/月",
      [
        "公司名称：星链科技",
        "办公方式：可远程",
        "时区：UTC+8",
        "雇佣类型：全职",
        "岗位职责：负责智能合约开发与链上数据服务",
        "应聘方式：微信 abc_hr 或邮箱 hr@example.cn",
      ].join("\n"),
    );

    expect(parsed.company).toBe("星链科技");
    expect(parsed.location).toBe("上海/远程");
    expect(parsed.remote).toBe(true);
    expect(parsed.salary).toContain("25k-40k RMB/月");
    expect(parsed.salary_min).toBe(25000);
    expect(parsed.salary_max).toBe(40000);
    expect(parsed.salary_currency).toBe("CNY");
    expect(parsed.salary_period).toBe("month");
    expect(parsed.timezone).toBe("UTC+8");
    expect(parsed.employment_type).toBe("全职");
    expect(parsed.responsibilities).toContain("智能合约开发");
    expect(parsed.contact_channels).toContain("wechat");
    expect(parsed.contact_channels).toContain("email:hr@example.cn");
  });

  it("detects onsite-only jobs and keeps remote false", () => {
    const parsed = parseIssueText(
      "[Beijing] Example Co hiring QA Engineer",
      "Work mode: onsite only\nCompensation: 30k-50k RMB",
    );

    expect(parsed.remote).toBe(false);
    expect(parsed.work_mode).toBe("onsite only");
    expect(parsed.salary_min).toBe(30000);
    expect(parsed.salary_max).toBe(50000);
    expect(parsed.salary_currency).toBe("CNY");
  });
});

describe("issueToNormalized", () => {
  it("builds normalized record with enriched fields", () => {
    const normalized = issueToNormalized({
      id: 1,
      number: 10,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/10",
      title: "[HK/Remote] Example Co hiring QA Engineer",
      body: [
        "Salary: 30K-50K HKD / month",
        "Employment Type: Contract",
        "Contact: https://t.me/example_hr",
      ].join("\n"),
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
    expect(normalized.salary_currency).toBe("HKD");
    expect(normalized.salary_period).toBe("month");
    expect(normalized.employment_type).toBe("Contract");
    expect(normalized.contact_channels).toContain("https://t.me/example_hr");
    expect(normalized.completeness_score).toBe(80);
    expect(normalized.completeness_grade).toBe("B");
    expect(normalized.missing_fields).toEqual(["responsibilities"]);
  });
});
