import { GitHubIssue, NormalizedJob } from "./schemas.js";

const FIELD_RE = /^\s*(?<key>[\w\s/\-]+?)\s*[:：]\s*(?<value>.+)$/;
const SALARY_RE = /(?:\$|USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|K|k|万|千|\d+[-~]\d+)/;
const REMOTE_RE = /\bremote\b|远程|居家|在家/i;

export type ParsedIssue = {
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  remote: boolean;
  summary: string;
  fields: Record<string, string>;
};

export function parseIssueText(title: string, body?: string | null): ParsedIssue {
  const content = (body ?? "").trim();
  const fields = extractFields(content);
  const summary = extractSummary(content);

  const company = fields["company"] ?? fields["company name"] ?? guessCompany(title);
  const location = fields["location"] ?? guessLocation(title, content);
  const salary = fields["salary"] ?? guessSalary(title, content);
  const remote = Boolean(fields["remote"]) || REMOTE_RE.test(`${title}\n${content}`);

  return {
    title: title.trim(),
    company: clean(company),
    location: clean(location),
    salary: clean(salary),
    remote,
    summary,
    fields,
  };
}

export function issueToNormalized(issue: GitHubIssue): NormalizedJob {
  const parsed = parseIssueText(issue.title, issue.body);
  const labels = issue.labels
    .map((label) => label.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  return {
    id: issue.id,
    number: issue.number,
    url: issue.html_url,
    title: parsed.title,
    company: parsed.company,
    location: parsed.location,
    salary: parsed.salary,
    remote: parsed.remote,
    state: issue.state,
    labels,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    summary: parsed.summary,
    raw_body: issue.body ?? "",
    author: issue.user?.login ?? null,
  };
}

function extractFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const matched = line.match(FIELD_RE);
    if (!matched?.groups) {
      continue;
    }
    fields[matched.groups.key.trim().toLowerCase()] = matched.groups.value.trim();
  }
  return fields;
}

function extractSummary(body: string): string {
  const paragraphs = body.split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const text = paragraph.trim();
    if (text) {
      return text.slice(0, 400);
    }
  }
  return "";
}

function guessLocation(title: string, body: string): string | null {
  const bracketMatch = title.match(/\[([^\]]+)\]/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1];
  }

  for (const key of ["base", "onsite", "office"]) {
    const match = body.match(new RegExp(`${key}\\s*[:：]\\s*([^\\n]+)`, "i"));
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function guessSalary(title: string, body: string): string | null {
  const text = `${title}\n${body}`;
  if (!SALARY_RE.test(text)) {
    return null;
  }

  const match = text.match(/([\$]?[0-9][0-9,.\-\s]{2,30}\s*(?:USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|K|k|万|千)?)/);
  return match?.[1]?.trim() ?? null;
}

function guessCompany(title: string): string | null {
  const match = title.match(/([A-Za-z][A-Za-z0-9&\-.\s]{1,50})(?:\s+(?:is looking|hiring|诚聘|招聘))/i);
  return match?.[1]?.trim() ?? null;
}

function clean(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact || null;
}
