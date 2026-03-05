import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const allPayload = JSON.parse(fs.readFileSync(path.join(repoRoot, "data/jobs.normalized.json"), "utf8"));
const publicPayload = JSON.parse(fs.readFileSync(path.join(repoRoot, "public/jobs.normalized.json"), "utf8"));

const jobs = allPayload.jobs;
const renderedByNumber = new Map(publicPayload.jobs.map((j) => [j.number, j]));

const fieldDefs = [
  { key: "company", label: "company" },
  { key: "location", label: "location" },
  { key: "salary", label: "salary" },
  { key: "salary_currency", label: "salary_currency" },
  { key: "salary_period", label: "salary_period" },
  { key: "work_mode", label: "work_mode" },
  { key: "timezone", label: "timezone" },
  { key: "employment_type", label: "employment_type" },
  { key: "responsibilities", label: "responsibilities" },
  { key: "contact_channels", label: "contact_channels" },
];

const signalDefs = {
  company: /(?:\b(?:company|company\s*name|employer|team)\b\s*[:：])|(?:公司|公司名称|团队)\s*[:：]|(?:\bwe\s+are\s+hiring\b)|(?:\bis\s+hiring\b)|(?:招聘|诚聘)/im,
  salary: /(?:\b(?:salary|compensation|package|薪资|薪酬|薪水|月薪|年薪|待遇)\b\s*[:：]?)|(?:(?:[$¥￥]|\b(?:USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|TWD)\b)\s*\d)|(?:\d\s*[kKwW万]\s*(?:-|~|–|—|至|to|\+))/im,
  location: /(?:\b(?:location|office|onsite|city|base)\b\s*[:：])|(?:工作地点|地点|城市|所在地|办公地点)\s*[:：]|\[(?:[^\]]{2,40})\]/im,
  remote: /\b(?:remote|wfh|hybrid|on[-\s]?site|onsite)\b|远程|居家|分布式|线下|坐班/im,
  contact: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|\b(?:telegram|wechat|discord|linkedin|twitter|x)\b|微信|tg[:：]?\s*@?[\w_]+/im,
  timezone: /\b(?:timezone|time\s*zone|utc|gmt)\b|时区/im,
  employment_type: /\b(?:full[- ]?time|part[- ]?time|contract|intern(ship)?|兼职|全职|实习|外包|顾问)\b/im,
};

function hasValue(job, key) {
  if (key === "contact_channels") {
    return Array.isArray(job.contact_channels) && job.contact_channels.length > 0;
  }
  const value = job[key];
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function hasSignal(rawBody, title, key) {
  const text = `${title || ""}\n${rawBody || ""}`;
  return Boolean(signalDefs[key]?.test(text));
}

const coverage = fieldDefs.map((f) => {
  const present = jobs.filter((j) => hasValue(j, f.key)).length;
  const missing = jobs.length - present;
  return {
    field: f.label,
    present,
    missing,
    coverage_rate: Number((present / jobs.length).toFixed(4)),
    missing_rate: Number((missing / jobs.length).toFixed(4)),
  };
});

const signalCoverage = Object.keys(signalDefs).map((key) => {
  const withSignal = jobs.filter((j) => hasSignal(j.raw_body, j.title, key));
  const extracted = withSignal.filter((j) => {
    if (key === "remote") return j.remote === true || Boolean(j.work_mode);
    if (key === "contact") return hasValue(j, "contact_channels");
    return hasValue(j, key);
  });
  const n = withSignal.length;
  return {
    field: key,
    issues_with_signal: n,
    extracted: extracted.length,
    extraction_rate_given_signal: n ? Number((extracted.length / n).toFixed(4)) : 0,
  };
});

function classifyMissing(reasonContext) {
  if (reasonContext.kind === "not_rendered") return "template_variance";
  if (reasonContext.kind === "parser_miss") {
    if (reasonContext.rawLength < 180 || reasonContext.weakSignal) return "noisy_post";
    return "parser_gap";
  }
  return "parser_gap";
}

const keyFields = ["company", "salary", "location", "remote", "contact", "timezone", "employment_type"];
const discrepancyRows = [];

for (const job of publicPayload.jobs) {
  const rendered = renderedByNumber.get(job.number);
  const missingItems = [];

  for (const key of keyFields) {
    const signalPresent = hasSignal(job.raw_body, job.title, key);
    if (!signalPresent) continue;

    let parsedPresent = false;
    if (key === "remote") parsedPresent = job.remote === true || Boolean(job.work_mode);
    else if (key === "contact") parsedPresent = hasValue(job, "contact_channels");
    else parsedPresent = hasValue(job, key);

    let renderedPresent = false;
    if (rendered) {
      if (key === "company") renderedPresent = hasValue(rendered, "company");
      else if (key === "salary") renderedPresent = hasValue(rendered, "salary");
      else if (key === "location") renderedPresent = hasValue(rendered, "location");
      else if (key === "remote") renderedPresent = rendered.remote === true;
      else renderedPresent = false;
    }

    if (!parsedPresent) {
      const reason = classifyMissing({ kind: "parser_miss", rawLength: (job.raw_body || "").length, weakSignal: !/[:：]/.test(job.raw_body || "") });
      missingItems.push({ field: key, reason, detail: "signal present in raw issue but parser did not extract" });
    } else if (!renderedPresent) {
      const reason = classifyMissing({ kind: "not_rendered" });
      missingItems.push({ field: key, reason, detail: "parsed value exists but website card does not render this field" });
    }
  }

  if (missingItems.length > 0) {
    const reasonCounts = missingItems.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] || 0) + 1;
      return acc;
    }, {});
    discrepancyRows.push({
      number: job.number,
      state: job.state,
      title: job.title,
      url: job.url,
      missing_count: missingItems.length,
      missing_fields: missingItems.map((m) => m.field),
      reason_breakdown: reasonCounts,
      missing_items: missingItems,
    });
  }
}

discrepancyRows.sort((a, b) => b.missing_count - a.missing_count || b.number - a.number);
const topDiscrepancies = discrepancyRows.slice(0, 75);

const reasonTotals = discrepancyRows.flatMap((r) => r.missing_items).reduce((acc, item) => {
  acc[item.reason] = (acc[item.reason] || 0) + 1;
  return acc;
}, {});

const audit = {
  generated_at: new Date().toISOString(),
  repo: allPayload.repo,
  totals: {
    all_issues: jobs.length,
    open_issues_rendered: publicPayload.jobs.length,
    open_issues_with_discrepancy: discrepancyRows.length,
  },
  field_coverage: coverage,
  signal_coverage: signalCoverage,
  reason_totals: reasonTotals,
  top_discrepancies: topDiscrepancies,
};

const outDir = path.join(repoRoot, "docs", "audit");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "extraction_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);

const lines = [];
lines.push("# Extraction Audit");
lines.push("");
lines.push(`Generated: ${audit.generated_at}`);
lines.push(`Repo: ${audit.repo}`);
lines.push(`All issues: ${audit.totals.all_issues}`);
lines.push(`Open issues rendered on website: ${audit.totals.open_issues_rendered}`);
lines.push(`Open issues with at least one discrepancy: ${audit.totals.open_issues_with_discrepancy}`);
lines.push("");
lines.push("## Per-field Coverage (all issues)");
lines.push("");
lines.push("| Field | Present | Missing | Coverage | Missing rate |");
lines.push("|---|---:|---:|---:|---:|");
for (const row of coverage) {
  lines.push(`| ${row.field} | ${row.present} | ${row.missing} | ${(row.coverage_rate * 100).toFixed(1)}% | ${(row.missing_rate * 100).toFixed(1)}% |`);
}
lines.push("");
lines.push("## Extraction Rate Given Raw Signal");
lines.push("");
lines.push("| Field | Issues with signal in raw | Extracted | Extraction rate |");
lines.push("|---|---:|---:|---:|");
for (const row of signalCoverage) {
  lines.push(`| ${row.field} | ${row.issues_with_signal} | ${row.extracted} | ${(row.extraction_rate_given_signal * 100).toFixed(1)}% |`);
}
lines.push("");
lines.push("## Discrepancy Reason Totals");
lines.push("");
for (const [reason, count] of Object.entries(reasonTotals).sort((a, b) => b[1] - a[1])) {
  lines.push(`- ${reason}: ${count}`);
}
lines.push("");
lines.push("## Top Issues with Missing Key Info on Website");
lines.push("");
lines.push("| Issue | State | Missing count | Missing fields | Reasons |");
lines.push("|---|---|---:|---|---|");
for (const row of topDiscrepancies.slice(0, 30)) {
  const reasons = Object.entries(row.reason_breakdown).map(([k, v]) => `${k}:${v}`).join(", ");
  lines.push(`| [#${row.number}](${row.url}) | ${row.state} | ${row.missing_count} | ${row.missing_fields.join(", ")} | ${reasons} |`);
}
lines.push("");
lines.push("## Prioritized Fixes");
lines.push("");
lines.push("1. Render parsed `contact_channels`, `employment_type`, `timezone`, and `work_mode` in `public/index.html` cards to close the largest template-variance gap.");
lines.push("2. Improve parser aliases for company/location/salary blocks that use numbered headings, emoji prefixes, or markdown tables (common parser-gap pattern).");
lines.push("3. Add fallback extraction for contact handles without URLs (e.g. `TG @name`, `微信: abc123`) and for salary single-value expressions (e.g. `40k+`).");
lines.push("4. Introduce parser confidence scoring and skip noisy low-signal posts from discrepancy counts or flag them separately.");
lines.push("5. Add regression tests from top discrepancy issues to lock in extraction behavior improvements.");

fs.writeFileSync(path.join(outDir, "extraction_audit.md"), `${lines.join("\n")}\n`);

console.log(`Wrote ${path.join(outDir, "extraction_audit.json")}`);
console.log(`Wrote ${path.join(outDir, "extraction_audit.md")}`);
