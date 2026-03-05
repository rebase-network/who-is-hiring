import { GitHubIssue, NormalizedJob } from "./schemas.js";

const FIELD_RE =
  /^\s*(?:[-*]\s*)?(?:\*\*|__)?(?<key>[\w\s/\-.\u4e00-\u9fff]+?)(?:\*\*|__)?\s*[:：]\s*(?<value>.*)$/;
const TITLE_BRACKET_RE = /\[([^\]]+)\]/g;
const REMOTE_RE = /\bremote\b|远程|居家|在家|分布式|wfh/i;

const FIELD_ALIASES: Record<string, string> = {
  company: "company",
  companyname: "company",
  employer: "company",
  team: "company",
  公司: "company",
  公司名称: "company",
  团队: "company",

  location: "location",
  base: "location",
  office: "location",
  onsite: "location",
  city: "location",
  工作地点: "location",
  地点: "location",
  城市: "location",
  所在地: "location",
  办公地点: "location",

  salary: "salary",
  compensation: "salary",
  package: "salary",
  薪资: "salary",
  薪酬: "salary",
  薪水: "salary",
  月薪: "salary",
  年薪: "salary",
  待遇: "salary",

  remote: "work_mode",
  workplace: "work_mode",
  workmode: "work_mode",
  workingmode: "work_mode",
  officepolicy: "work_mode",
  办公方式: "work_mode",
  工作方式: "work_mode",
  远程: "work_mode",

  timezone: "timezone",
  timezonerequirement: "timezone",
  时区: "timezone",

  employmenttype: "employment_type",
  jobtype: "employment_type",
  roletype: "employment_type",
  全职兼职: "employment_type",
  雇佣类型: "employment_type",
  用工类型: "employment_type",
  职位类型: "employment_type",

  responsibilities: "responsibilities",
  responsibility: "responsibilities",
  jobdescription: "responsibilities",
  description: "responsibilities",
  岗位职责: "responsibilities",
  工作职责: "responsibilities",
  职责: "responsibilities",

  contact: "contact",
  contacts: "contact",
  contactinfo: "contact",
  contactinformation: "contact",
  apply: "contact",
  application: "contact",
  联系方式: "contact",
  联系: "contact",
  应聘方式: "contact",
  投递方式: "contact",
};

const CURRENCY_PATTERNS: Array<{ token: string; currency: string }> = [
  { token: "USDT", currency: "USDT" },
  { token: "USD", currency: "USD" },
  { token: "HKD", currency: "HKD" },
  { token: "CNY", currency: "CNY" },
  { token: "RMB", currency: "CNY" },
  { token: "SGD", currency: "SGD" },
  { token: "EUR", currency: "EUR" },
  { token: "GBP", currency: "GBP" },
  { token: "TWD", currency: "TWD" },
  { token: "$", currency: "USD" },
  { token: "¥", currency: "CNY" },
  { token: "￥", currency: "CNY" },
  { token: "元", currency: "CNY" },
  { token: "刀", currency: "USD" },
  { token: "港币", currency: "HKD" },
  { token: "台币", currency: "TWD" },
];

export type ParsedIssue = {
  title: string;
  company: string | null;
  location: string | null;
  salary: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  remote: boolean;
  work_mode: string | null;
  timezone: string | null;
  employment_type: string | null;
  responsibilities: string | null;
  contact_channels: string[];
  summary: string;
  fields: Record<string, string>;
};

export function parseIssueText(title: string, body?: string | null): ParsedIssue {
  const content = (body ?? "").trim();
  const fields = extractFields(content);
  const summary = extractSummary(content);

  const company = fields.company ?? guessCompany(title, content);
  const location = fields.location ?? guessLocation(title, content);
  const salary = fields.salary ?? guessSalary(title, content);
  const salaryMeta = parseSalaryMeta(salary ?? `${title}\n${content}`);
  const workMode = fields.work_mode ?? guessWorkMode(title, content);
  const remote = isRemote(workMode, title, content);

  return {
    title: title.trim(),
    company: clean(company),
    location: clean(location),
    salary: clean(salary),
    salary_min: salaryMeta.min,
    salary_max: salaryMeta.max,
    salary_currency: salaryMeta.currency,
    salary_period: salaryMeta.period,
    remote,
    work_mode: clean(workMode),
    timezone: clean(fields.timezone ?? guessTimezone(content)),
    employment_type: clean(fields.employment_type ?? guessEmploymentType(title, content)),
    responsibilities: clean(fields.responsibilities),
    contact_channels: extractContactChannels(content),
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
    salary_min: parsed.salary_min,
    salary_max: parsed.salary_max,
    salary_currency: parsed.salary_currency,
    salary_period: parsed.salary_period,
    remote: parsed.remote,
    work_mode: parsed.work_mode,
    timezone: parsed.timezone,
    employment_type: parsed.employment_type,
    responsibilities: parsed.responsibilities,
    contact_channels: parsed.contact_channels,
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
  const lines = body.split("\n");
  let activeKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const matched = line.match(FIELD_RE);
    if (matched?.groups) {
      const key = canonicalFieldKey(matched.groups.key);
      if (!key) {
        activeKey = null;
        continue;
      }
      const value = matched.groups.value.trim();
      if (value) {
        fields[key] = mergeFieldValue(fields[key], value);
        activeKey = null;
      } else {
        activeKey = key;
      }
      continue;
    }

    if (!activeKey || !line || /^#{1,6}\s/.test(line)) {
      activeKey = null;
      continue;
    }

    if (line.startsWith("-") || line.startsWith("*")) {
      fields[activeKey] = mergeFieldValue(fields[activeKey], line.replace(/^[-*]\s*/, ""));
      continue;
    }

    fields[activeKey] = mergeFieldValue(fields[activeKey], line);
  }

  return fields;
}

function canonicalFieldKey(input: string): string | null {
  const normalized = input
    .toLowerCase()
    .replace(/[\s/_.-]+/g, "")
    .replace(/[()（）\[\]【】]/g, "")
    .trim();
  return FIELD_ALIASES[normalized] ?? null;
}

function mergeFieldValue(existing: string | undefined, next: string): string {
  return existing ? `${existing}\n${next}` : next;
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
  const bracketMatches = Array.from(title.matchAll(TITLE_BRACKET_RE));
  for (const match of bracketMatches) {
    const candidate = match[1]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  const text = `${title}\n${body}`;
  const match = text.match(/(?:base|office|onsite|location|工作地点|地点|城市)\s*[:：]\s*([^\n]+)/i);
  return match?.[1]?.trim() ?? null;
}

function guessSalary(title: string, body: string): string | null {
  const text = `${title}\n${body}`;
  const withLabel = text.match(/(?:salary|compensation|薪资|薪酬|薪水|月薪|年薪)\s*[:：]?\s*([^\n]+)/i);
  if (withLabel?.[1]) {
    return withLabel[1].trim();
  }

  const range = text.match(/(?:[$¥￥]|USDT|USD|RMB|CNY|HKD|SGD|EUR|GBP|TWD)?\s*\d[\d,]*(?:\.\d+)?\s*(?:[kKwW万千])?\s*(?:[-~–—至]|to)\s*(?:[$¥￥]|USDT|USD|RMB|CNY|HKD|SGD|EUR|GBP|TWD)?\s*\d[\d,]*(?:\.\d+)?\s*(?:[kKwW万千])?(?:\s*(?:USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|TWD|\/月|\/年|\/hour|\/hr|月|年|小时|时))?/i);
  return range?.[0]?.trim() ?? null;
}

function guessCompany(title: string, body: string): string | null {
  const fromTitle = title.match(/([A-Za-z][A-Za-z0-9&\-.\s]{1,60})(?:\s+(?:is looking|is hiring|hiring|招聘|诚聘))/i);
  if (fromTitle?.[1]) {
    return fromTitle[1].trim();
  }

  const fromBody = body.match(/(?:公司|团队|Company)\s*[:：]\s*([^\n]+)/i);
  return fromBody?.[1]?.trim() ?? null;
}

function guessWorkMode(title: string, body: string): string | null {
  const text = `${title}\n${body}`;
  const mode = text.match(/(?:remote|onsite|on-site|hybrid|可远程|远程|线下|坐班|混合办公)/i);
  return mode?.[0] ?? null;
}

function guessTimezone(body: string): string | null {
  const match = body.match(/(?:timezone|time\s*zone|时区)\s*[:：]?\s*([^\n]+)/i);
  return match?.[1]?.trim() ?? null;
}

function guessEmploymentType(title: string, body: string): string | null {
  const text = `${title}\n${body}`;
  const match = text.match(/(?:full[- ]?time|part[- ]?time|contract|intern|兼职|全职|实习|外包|顾问)/i);
  return match?.[0] ?? null;
}

function isRemote(workMode: string | null | undefined, title: string, body: string): boolean {
  const text = `${workMode ?? ""}\n${title}\n${body}`;
  if (/onsite only|on-site only|仅线下|仅现场/i.test(text)) {
    return false;
  }
  return REMOTE_RE.test(text);
}

function parseSalaryMeta(text: string): {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: string | null;
} {
  if (!text) {
    return { min: null, max: null, currency: null, period: null };
  }

  const currency = detectCurrency(text);
  const period = detectPeriod(text);
  const rangeMatch = text.match(
    /(\d[\d,.]*\s*[kKwW万千]?)(?:\s*[-~–—至]\s*|\s+to\s+)(\d[\d,.]*\s*[kKwW万千]?)/i,
  );

  if (rangeMatch) {
    return {
      min: toNumber(rangeMatch[1]),
      max: toNumber(rangeMatch[2]),
      currency,
      period,
    };
  }

  const plusMatch = text.match(/(\d[\d,.]*\s*[kKwW万千]?)\s*\+/i);
  if (plusMatch) {
    return {
      min: toNumber(plusMatch[1]),
      max: null,
      currency,
      period,
    };
  }

  return { min: null, max: null, currency, period };
}

function toNumber(input: string): number | null {
  const compact = input.replace(/[\s,]/g, "").toLowerCase();
  const numeric = Number.parseFloat(compact.replace(/[kw万千]/g, ""));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (compact.endsWith("k")) {
    return numeric * 1_000;
  }
  if (compact.endsWith("w") || compact.endsWith("万")) {
    return numeric * 10_000;
  }
  if (compact.endsWith("千")) {
    return numeric * 1_000;
  }
  return numeric;
}

function detectCurrency(text: string): string | null {
  for (const entry of CURRENCY_PATTERNS) {
    if (text.toUpperCase().includes(entry.token.toUpperCase())) {
      return entry.currency;
    }
  }
  return null;
}

function detectPeriod(text: string): string | null {
  if (/(?:\/\s*|per\s*|每\s*)(?:month|mo|月)/i.test(text) || /月薪/i.test(text)) {
    return "month";
  }
  if (/(?:\/\s*|per\s*|每\s*)(?:year|yr|年)/i.test(text) || /年薪/i.test(text)) {
    return "year";
  }
  if (/(?:\/\s*|per\s*|每\s*)(?:hour|hr|小时|时)/i.test(text)) {
    return "hour";
  }
  return null;
}

function extractContactChannels(body: string): string[] {
  const channels = new Set<string>();

  const emailMatches = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emailMatches) {
    channels.add(`email:${email}`);
  }

  const links = body.match(/https?:\/\/[^\s)]+/gi) ?? [];
  for (const url of links) {
    channels.add(url);
  }

  const taggedChannels: Array<[RegExp, string]> = [
    [/\btelegram\b|tg[:：]?\s*@?[\w_]+/i, "telegram"],
    [/\bdiscord\b/i, "discord"],
    [/\bwechat\b|微信/i, "wechat"],
    [/\bx\b|twitter/i, "x"],
    [/\blinkedin\b/i, "linkedin"],
  ];

  for (const [pattern, name] of taggedChannels) {
    if (pattern.test(body)) {
      channels.add(name);
    }
  }

  return Array.from(channels);
}

function clean(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact || null;
}
