import { computeCompleteness } from "./feedback.js";
import { GitHubIssue, NormalizedJob, RichJob } from "./schemas.js";

const FIELD_RE =
  /^\s*(?:[-*]\s*)?(?:\*\*|__)?(?<key>[\w\s/\-.\u4e00-\u9fff]+?)(?:\*\*|__)?\s*[:：]\s*(?<value>.*)$/;
const TABLE_ROW_RE = /^\s*\|(?<key>[^|]+)\|(?<value>[^|]+)\|\s*$/;
const TITLE_BRACKET_RE = /\[([^\]]+)\]/g;
const TITLE_PREFIX_RE = /^(?:\[[^\]]+\]\s*)+/;
const REMOTE_RE = /\bremote\b|远程|远端|居家|在家|分布式|wfh/i;
const SECTION_HEADING_RE = /^(#{1,6}\s*)?(?<name>about|overview|role\s*overview|key\s*responsibilities|responsibilities|requirements|contact\s*(?:information)?|how\s*to\s*apply|benefits|任职要求|任职资格|职位要求|主要职责|职责|岗位职责|工作职责|岗位要求、职责|职位要求与职责|联系方式|你负责|我们需要的你|我们希望你|你需要搞定|核心挑战|加分项|bonus\s*qualifications?)\s*[:：]?$/i;

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
  工作地: "location",
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
  是否远程: "work_mode",
  远程: "work_mode",

  timezone: "timezone",
  timezonerequirement: "timezone",
  时区: "timezone",

  employmenttype: "employment_type",
  jobtype: "employment_type",
  roletype: "employment_type",
  jobnature: "employment_type",
  全职兼职: "employment_type",
  是否全职: "employment_type",
  工作性质: "employment_type",
  工作类型: "employment_type",
  雇佣类型: "employment_type",
  用工类型: "employment_type",
  职位类型: "employment_type",

  responsibilities: "responsibilities",
  responsibility: "responsibilities",
  keyresponsibilities: "responsibilities",
  jobdescription: "responsibilities",
  description: "responsibilities",
  主要职责: "responsibilities",
  岗位职责: "responsibilities",
  工作职责: "responsibilities",
  职责: "responsibilities",
  "岗位要求、职责": "responsibilities",
  岗位要求职责: "responsibilities",
  职位要求与职责: "responsibilities",
  你负责: "responsibilities",
  你需要搞定: "responsibilities",
  核心挑战: "responsibilities",

  requirements: "requirements",
  qualification: "requirements",
  qualifications: "requirements",
  要求: "requirements",
  任职要求: "requirements",
  任职资格: "requirements",
  职位要求: "requirements",
  岗位要求: "requirements",
  我们需要的你: "requirements",
  我们希望你: "requirements",
  加分项: "requirements",
  bonusqualifications: "requirements",

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

const INLINE_FIELD_LABELS = [
  "Contact Information",
  "Contact Info",
  "How to Apply",
  "Company Name",
  "Employment Type",
  "Job Nature",
  "Job Type",
  "Key Responsibilities",
  "Work mode",
  "Work Mode",
  "Working mode",
  "Working Mode",
  "Office policy",
  "Office Policy",
  "Timezone",
  "Time zone",
  "Company",
  "Employer",
  "Team",
  "Location",
  "Base",
  "Office",
  "Onsite",
  "City",
  "Salary",
  "Compensation",
  "Package",
  "Responsibilities",
  "Responsibility",
  "Requirements",
  "Qualification",
  "Qualifications",
  "Contact",
  "Contacts",
  "Apply",
  "Application",
  "公司名称",
  "公司",
  "团队",
  "工作地点",
  "工作地",
  "地点",
  "城市",
  "所在地",
  "办公地点",
  "薪资",
  "薪酬",
  "薪水",
  "月薪",
  "年薪",
  "待遇",
  "办公方式",
  "工作方式",
  "时区",
  "是否全职",
  "工作性质",
  "工作类型",
  "雇佣类型",
  "用工类型",
  "职位类型",
  "岗位职责",
  "工作职责",
  "职责",
  "你负责",
  "你需要搞定",
  "核心挑战",
  "任职要求",
  "岗位要求",
  "我们需要的你",
  "我们希望你",
  "加分项",
  "联系方式",
  "联系",
  "应聘方式",
  "投递方式",
].sort((a, b) => b.length - a.length);

const INLINE_FIELD_LABEL_RE = new RegExp(`(?:${INLINE_FIELD_LABELS.map(escapeRegExp).join("|")})\\s*[:：]`, "giu");

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
  requirements: string | null;
  contact_channels: string[];
  summary: string;
  fields: Record<string, string>;
};

type RichSection = {
  title: string;
  paragraphs: string[];
  bullets: string[];
};

export function parseIssueText(title: string, body?: string | null): ParsedIssue {
  const content = (body ?? "").trim();
  const fields = extractFields(content);
  const summary = extractSummary(content, title);

  const company = fields.company ?? guessCompany(title, content);
  const location = fields.location ?? guessLocation(title, content);
  const salary = choosePreferredSalary(fields.salary ?? null, guessSalary(title, ""), guessSalary("", content));
  const salaryMeta = parseSalaryMeta(salary ?? "");
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
    requirements: clean(fields.requirements),
    contact_channels: extractContactChannels(content),
    summary,
    fields,
  };
}

export function issueToRich(issue: GitHubIssue): RichJob {
  const parsed = parseIssueText(issue.title, issue.body);
  const body = issue.body ?? "";
  const sections = extractRichSections(body);
  const responsibilityCandidates = toLines(parsed.fields.responsibilities).concat(findSectionLines(sections, /responsibilities|职责|核心挑战|你负责|你需要搞定/i));
  const requirementCandidates = toLines(parsed.fields.requirements)
    .concat(findSectionLines(sections, /requirements|qualification|任职要求|任职资格|职位要求|岗位要求|我们需要的你|我们希望你|加分项/i))
    .concat(inferRequirementsFromLooseSections(sections));
  const responsibilities = uniq(filterResponsibilityLines(
    responsibilityCandidates.length ? responsibilityCandidates : inferResponsibilitiesFromGeneralSection(sections),
  ));
  const requirements = uniq(filterRequirementLines(requirementCandidates));
  const compensationNotes = toLines(parsed.salary).concat(toLines(parsed.fields.salary)).concat(findSectionLines(sections, /compensation|salary|薪资|薪酬|待遇/i));
  const contactDetails = uniq(toLines(parsed.fields.contact).concat(parsed.contact_channels));
  const narrative = extractNarrativeParagraphs(body);

  const labels = issue.labels
    .map((label) => label.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  const normalizedResponsibilities = preferRicherText(parsed.responsibilities, joinRichTextLines(responsibilities));
  const normalizedRequirements = preferRicherText(parsed.requirements, joinRichTextLines(requirements));
  const fieldSources = buildFieldSources({
    title: parsed.title,
    fields: parsed.fields,
    company: parsed.company,
    location: parsed.location,
    salary: parsed.salary,
    work_mode: parsed.work_mode,
    employment_type: parsed.employment_type,
    responsibilities: normalizedResponsibilities,
    requirements: normalizedRequirements,
    contact_channels: parsed.contact_channels,
  });
  const completeness = computeCompleteness({
    title: parsed.title,
    company: parsed.company,
    location: parsed.location,
    salary: parsed.salary,
    salary_currency: parsed.salary_currency,
    salary_period: parsed.salary_period,
    work_mode: parsed.work_mode,
    employment_type: parsed.employment_type,
    responsibilities: normalizedResponsibilities,
    requirements: normalizedRequirements,
    contact_channels: parsed.contact_channels,
    field_sources: fieldSources,
  });

  return {
    id: issue.id,
    number: issue.number,
    url: issue.html_url,
    title: parsed.title,
    state: issue.state,
    labels,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    author: issue.user?.login ?? null,
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
    summary: parsed.summary,
    responsibilities: uniq(responsibilities),
    requirements: uniq(requirements),
    compensation_notes: uniq(compensationNotes),
    contact_details: contactDetails,
    sections,
    narrative,
    raw_body: body,
    completeness_score: completeness.score,
    completeness_grade: completeness.grade,
    missing_fields: completeness.missing_fields,
    weak_fields: completeness.weak_fields,
    risk_flags: completeness.risk_flags,
    score_breakdown: completeness.score_breakdown,
    field_sources: fieldSources,
    comment_supplemented_fields: [],
    decision_value_score: completeness.decision_value_score,
    credibility_score: completeness.credibility_score,
  };
}

export function richToNormalized(job: RichJob): NormalizedJob {
  return {
    id: job.id,
    number: job.number,
    url: job.url,
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    salary_currency: job.salary_currency,
    salary_period: job.salary_period,
    remote: job.remote,
    work_mode: job.work_mode,
    timezone: job.timezone,
    employment_type: job.employment_type,
    responsibilities: joinRichTextLines(job.responsibilities),
    requirements: joinRichTextLines(job.requirements),
    contact_channels: job.contact_details,
    completeness_score: job.completeness_score,
    completeness_grade: job.completeness_grade,
    missing_fields: job.missing_fields,
    weak_fields: job.weak_fields,
    risk_flags: job.risk_flags,
    score_breakdown: job.score_breakdown,
    field_sources: job.field_sources,
    comment_supplemented_fields: job.comment_supplemented_fields,
    decision_value_score: job.decision_value_score,
    credibility_score: job.credibility_score,
    state: job.state,
    labels: job.labels,
    created_at: job.created_at,
    updated_at: job.updated_at,
    closed_at: job.closed_at,
    summary: job.summary,
    author: job.author,
  };
}

export function issueToNormalized(issue: GitHubIssue): NormalizedJob {
  return richToNormalized(issueToRich(issue));
}

export function isLikelyHiringRichJob(job: Pick<RichJob, "title" | "company" | "location" | "salary" | "work_mode" | "employment_type" | "responsibilities" | "requirements" | "contact_details" | "raw_body">): boolean {
  const title = clean(job.title) ?? "";
  const body = clean(job.raw_body) ?? "";
  const hiringSignal = /(hiring|hire|recruit|job opening|looking for|招聘|诚聘|招募|岗位|职位|工程师|开发|测试|运营|产品|designer|developer|engineer|manager)/i.test(`${title}\n${body}`);
  const structuredSignals = [
    clean(job.company),
    clean(job.location),
    clean(job.salary),
    clean(job.work_mode),
    clean(job.employment_type),
    ...(job.responsibilities ?? []).map((item) => clean(item)).filter(Boolean),
    ...(job.requirements ?? []).map((item) => clean(item)).filter(Boolean),
    ...(job.contact_details ?? []).map((item) => clean(item)).filter(Boolean),
  ].filter(Boolean).length;

  return structuredSignals >= 2 || (hiringSignal && structuredSignals >= 1);
}

function buildFieldSources(params: {
  title: string;
  fields: Record<string, string>;
  company: string | null;
  location: string | null;
  salary: string | null;
  work_mode: string | null;
  employment_type: string | null;
  responsibilities: string | null;
  requirements: string | null;
  contact_channels: string[];
}): Record<string, "title" | "body" | "derived" | "none"> {
  const hasField = (key: string) => Boolean(clean(params.fields[key]));
  return {
    title: clean(params.title) ? "title" : "none",
    company: hasField("company") ? "body" : params.company ? "derived" : "none",
    location: hasField("location") ? "body" : params.location ? "derived" : "none",
    salary: hasField("salary") ? "body" : params.salary ? "derived" : "none",
    work_mode: hasField("work_mode") ? "body" : params.work_mode ? "derived" : "none",
    employment_type: hasField("employment_type") ? "body" : params.employment_type ? "derived" : "none",
    responsibilities: hasField("responsibilities") ? "body" : params.responsibilities ? "derived" : "none",
    requirements: hasField("requirements") ? "body" : params.requirements ? "derived" : "none",
    contact_channels: params.contact_channels.length > 0 ? "body" : "none",
  };
}

function extractFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let activeKey: string | null = null;

  for (const sourceLine of body.split("\n")) {
    for (const rawLine of splitCompactMetadataLine(sourceLine)) {
      const line = rawLine.trim();
      const normalizedLine = line
        .replace(/^[\d.)\-\s]+/, "")
        .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "");

      const tableMatch = normalizedLine.match(TABLE_ROW_RE);
      if (tableMatch?.groups) {
        const key = canonicalFieldKey(tableMatch.groups.key);
        if (key && !/^[-: ]+$/.test(tableMatch.groups.value.trim())) {
          fields[key] = mergeFieldValue(fields[key], tableMatch.groups.value.trim());
        }
        activeKey = null;
        continue;
      }

      const matched = normalizedLine.match(FIELD_RE);
      if (matched?.groups) {
        const key = canonicalFieldKey(matched.groups.key);
        if (!key) {
          activeKey = null;
          continue;
        }
        const value = normalizeCapturedFieldValue(key, matched.groups.key, matched.groups.value);
        if (value) {
          fields[key] = mergeFieldValue(fields[key], value);
          activeKey = null;
        } else {
          activeKey = key;
        }
        continue;
      }

      const headingMatch = normalizedLine.match(SECTION_HEADING_RE);
      if (headingMatch?.groups?.name) {
        const headingKey = canonicalFieldKey(headingMatch.groups.name);
        activeKey = headingKey;
        continue;
      }

      if (!activeKey || !line || /^#{1,6}\s/.test(line)) {
        continue;
      }

      if (/^(?:[-*•]|\d+[.)])\s+/.test(line)) {
        fields[activeKey] = mergeFieldValue(fields[activeKey], line.replace(/^(?:[-*•]|\d+[.)])\s+/, ""));
        continue;
      }

      fields[activeKey] = mergeFieldValue(fields[activeKey], line);
    }
  }

  return fields;
}

function splitCompactMetadataLine(rawLine: string): string[] {
  const matches = Array.from(rawLine.matchAll(INLINE_FIELD_LABEL_RE));
  if (matches.length <= 1) {
    return [rawLine];
  }

  const parts: string[] = [];
  let start = 0;
  for (let index = 1; index < matches.length; index += 1) {
    const nextStart = matches[index]?.index ?? -1;
    if (nextStart <= start) {
      continue;
    }
    const part = rawLine.slice(start, nextStart).trim();
    if (part) {
      parts.push(part);
    }
    start = nextStart;
  }

  const tail = rawLine.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }

  return parts.length > 0 ? parts : [rawLine];
}

function extractRichSections(body: string): RichSection[] {
  const sections: RichSection[] = [];
  let current: RichSection | null = null;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const heading = normalizeHeading(line);
    if (heading) {
      if (current && (current.paragraphs.length || current.bullets.length)) {
        sections.push(current);
      }
      current = { title: heading, paragraphs: [], bullets: [] };
      continue;
    }

    if (!current) {
      current = { title: "General", paragraphs: [], bullets: [] };
    }

    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet?.[1]) {
      current.bullets.push(bullet[1].trim());
      continue;
    }

    current.paragraphs.push(line);
  }

  if (current && (current.paragraphs.length || current.bullets.length)) {
    sections.push(current);
  }

  return sections;
}

function normalizeHeading(line: string): string | null {
  const isMarkdownHeading = /^#{1,6}\s*/.test(line);
  const value = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "")
    .replace(/[:：]$/, "")
    .replace(/^[*_]+|[*_]+$/g, "")
    .trim();
  if (!value || value.length > 80) {
    return null;
  }
  if (!/^[\p{L}\p{N}\s/&()\-]+$/u.test(value)) {
    return null;
  }

  if (/^(about(?:\s+\w+){0,2}|简介|关于我们)$/i.test(value)) return "About";
  if (/^(role\s*overview|overview|职位概述|岗位介绍)$/i.test(value)) return "Role Overview";
  if (/^(key\s*responsibilities|responsibilities|主要职责|职责|岗位职责|工作职责|核心挑战|你负责|你需要搞定)$/i.test(value)) return "Responsibilities";
  if (/^(requirements|qualification(?:s)?|任职要求|任职资格|职位要求|岗位要求|岗位要求、职责|职位要求与职责|我们需要的你|我们希望你|加分项|bonus\s*qualifications?)$/i.test(value)) return "Requirements";
  if (/^(contact(?:\s*information)?|how\s*to\s*apply|联系方式|应聘方式|投递方式)$/i.test(value)) return "Contact";
  if (/^(benefits|福利待遇)$/i.test(value)) return "Benefits";
  return isMarkdownHeading ? value : null;
}

function findSectionBullets(sections: RichSection[], pattern: RegExp): string[] {
  return sections.filter((s) => pattern.test(s.title)).flatMap((s) => s.bullets);
}

function findSectionLines(sections: RichSection[], pattern: RegExp): string[] {
  return sections
    .filter((s) => pattern.test(s.title))
    .flatMap((s) => [...s.paragraphs, ...s.bullets]);
}

function inferResponsibilitiesFromGeneralSection(sections: RichSection[]): string[] {
  const general = sections.find((section) => section.title === "General");
  if (!general) {
    return [];
  }

  return general.bullets.filter((line) => {
    const compact = cleanFieldValue(line);
    if (!compact) {
      return false;
    }
    if (looksLikeRequirementLine(compact) || looksLikeMetaLine(compact)) {
      return false;
    }
    return /^(?:打造|实现|定义|负责|主导|开发|设计|构建|Build|Own|Lead|Develop|Design)/i.test(compact);
  });
}

function inferRequirementsFromLooseSections(sections: RichSection[]): string[] {
  return sections
    .filter((section) => !/^(?:About|Benefits|Contact|Responsibilities)$/i.test(section.title))
    .flatMap((section) => [...section.bullets, ...section.paragraphs])
    .filter((line) => {
      const compact = cleanFieldValue(line);
      return compact != null && looksLikeRequirementLine(compact);
    });
}

function filterResponsibilityLines(lines: string[]): string[] {
  return lines
    .map((line) => cleanFieldValue(line))
    .filter((line): line is string => Boolean(line))
    .filter((line) => !looksLikeMetaLine(line))
    .filter((line) => !looksLikeRequirementLine(line))
    .filter((line) => line !== "**");
}

function filterRequirementLines(lines: string[]): string[] {
  return lines
    .map((line) => cleanFieldValue(line))
    .filter((line): line is string => Boolean(line))
    .filter((line) => !looksLikeMetaLine(line))
    .filter((line) => !looksLikeEmployerPitch(line))
    .filter((line) => line !== "**");
}

function looksLikeMetaLine(line: string): boolean {
  return /^(?:现场办公|工作地点|地点|location|联系方式|contact|tg|telegram|wechat|邮箱|email)\s*[:：]/i.test(line);
}

function looksLikeEmployerPitch(line: string): boolean {
  return /^(?:明星团队背书|资本与市场认可|全球化布局|拒绝内卷|关于\s|关于我们|团队基因|产品内核|技术愿景)/i.test(line);
}

function looksLikeRequirementLine(line: string): boolean {
  return /^(?:有|熟悉|精通|具备|了解|掌握|\d+[-+]?(?:年)?以上|\d+-\d+年|完成\d+年以上|本科|大专|经验|技能|要求|加分|希望你|我们需要的你|我们希望你|If you|Experience|Familiarity)/i.test(line);
}

function extractNarrativeParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((part) => !isMetadataOnlyParagraph(part, ""));
}

function canonicalFieldKey(input: string): string | null {
  const normalized = input
    .toLowerCase()
    .replace(/^#{1,6}\s*/, "")
    .replace(/[\s/_.-]+/g, "")
    .replace(/[()（）\[\]【】]/g, "")
    .trim();
  return FIELD_ALIASES[normalized] ?? null;
}

function mergeFieldValue(existing: string | undefined, next: string): string {
  return existing ? `${existing}\n${next}` : next;
}

function cleanFieldValue(value: string | undefined): string | null {
  const compact = value?.replace(/^[*_\s]+|[*_\s]+$/g, "").trim();
  return compact || null;
}

function normalizeCapturedFieldValue(key: string, rawKey: string, rawValue: string | undefined): string | null {
  const value = cleanFieldValue(rawValue);
  if (!value) {
    return null;
  }

  if (key === "employment_type") {
    if (/全职/i.test(rawKey)) {
      return /^(?:是|yes|true)$/i.test(value) ? "全职" : value;
    }
    if (/兼职/i.test(rawKey)) {
      return /^(?:是|yes|true)$/i.test(value) ? "兼职" : value;
    }
    if (/实习/i.test(rawKey)) {
      return /^(?:是|yes|true)$/i.test(value) ? "实习" : value;
    }
  }

  if (key === "work_mode") {
    if (/是否远程/.test(rawKey)) {
      if (/^(?:是|yes|true|remote)$/i.test(value)) {
        return "远程";
      }
      if (/^(?:否|no|false)$/i.test(value)) {
        return "非远程";
      }
    }
  }

  return value;
}

function extractSummary(body: string, title: string): string {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (isMetadataOnlyParagraph(paragraph, title)) {
      continue;
    }
    return paragraph.slice(0, 400);
  }

  return paragraphs[0]?.slice(0, 400) ?? "";
}

function isMetadataOnlyParagraph(paragraph: string, title: string): boolean {
  const compact = paragraph.replace(/\s+/g, " ").trim();
  const lower = compact.toLowerCase();
  const titleLower = title.trim().toLowerCase();

  if (!compact) {
    return true;
  }

  if (!compact.includes("\n") && /^(job\s*title|title|location|company|salary|薪资|职位|岗位|工作地点|地点)\s*[:：]/i.test(compact)) {
    return true;
  }

  if (compact.length < 80 && titleLower && (lower === titleLower || lower === `job title: ${titleLower}`)) {
    return true;
  }

  if (!compact.includes("\n") && /^(about(?:\s+\w+){0,2}|overview|role\s*overview|key\s*responsibilities|responsibilities|requirements|contact\s*(?:information)?)$/i.test(lower)) {
    return true;
  }

  return false;
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
  const labeledMatches = Array.from(text.matchAll(/(salary|compensation|薪资|薪酬|薪水|月薪|年薪)\s*[:：]?\s*([^\n]+)/gi));
  for (const match of labeledMatches) {
    const label = match[1]?.trim() ?? "";
    const labeled = match[2]?.trim() ?? "";
    if (looksLikeSalarySnippet(labeled)) {
      return /^(?:月薪|年薪)$/i.test(label) ? `${label} ${labeled}` : labeled;
    }
  }

  const range = text.match(/(?:[$¥￥]|USDT|USD|RMB|CNY|HKD|SGD|EUR|GBP|TWD)?\s*\d[\d,]*(?:\.\d+)?\s*(?:[kKwW万千])?\s*(?:[-~–—至]|to)\s*(?:[$¥￥]|USDT|USD|RMB|CNY|HKD|SGD|EUR|GBP|TWD)?\s*\d[\d,]*(?:\.\d+)?\s*(?:[kKwW万千])?(?:\s*(?:USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|TWD|\/月|\/年|\/hour|\/hr|\/m\b|月|年|小时|时))?/i);
  const plus = text.match(/(?:[$¥￥]|USDT|USD|RMB|CNY|HKD|SGD|EUR|GBP|TWD)?\s*\d[\d,]*(?:\.\d+)?\s*(?:[kKwW万千])?\s*\+(?:\s*(?:USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|TWD|\/月|\/年|\/hour|\/hr|\/m\b|月|年|小时|时))?/i);
  const candidate = range?.[0]?.trim() ?? plus?.[0]?.trim() ?? null;
  return looksLikeSalarySnippet(candidate) ? candidate : null;
}

function guessCompany(title: string, body: string): string | null {
  const fromTitle = title.match(/([A-Za-z][A-Za-z0-9&\-.\s]{1,60})(?:\s+(?:is looking|is hiring|hiring|招聘|诚聘))/i);
  if (fromTitle?.[1]) {
    return fromTitle[1].trim();
  }

  const englishCompanyPrefix = guessEnglishCompanyFromTitle(title);
  if (englishCompanyPrefix) {
    return englishCompanyPrefix;
  }

  // Support Chinese title patterns like "游戏集团诚聘" / "某某公司招聘" / "游戏集团 招 SEO主管".
  const zhFromTitle = title.match(/(?:\]|】|\)|）|^)\s*([\u4e00-\u9fffA-Za-z0-9·&\-.\s]{2,40}?)(?:诚聘|招聘|招募|招\s+)/);
  if (zhFromTitle?.[1]) {
    return zhFromTitle[1].trim().replace(/\s+/g, " ");
  }

  const suffixFromTitle = title.match(/(?:\]|】|\)|）|^)\s*([\u4e00-\u9fffA-Za-z0-9·&\-.\s]{2,40}?(?:公司|团队|集团|平台|工作室|实验室|研究院))/);
  if (suffixFromTitle?.[1]) {
    return suffixFromTitle[1].trim().replace(/\s+/g, " ");
  }

  const introFromBody = guessCompanyFromBodyIntro(body);
  if (introFromBody) {
    return introFromBody;
  }

  const fromBody = body.match(/(?:公司|团队|Company)\s*[:：]\s*([^\n]+)/i);
  return fromBody?.[1]?.trim() ?? null;
}

function guessEnglishCompanyFromTitle(title: string): string | null {
  const stripped = title.replace(TITLE_PREFIX_RE, "").trim();
  const companyLikePatterns = [
    /^([A-Za-z][A-Za-z0-9.,&()'\-/ ]{1,80}?(?:company|co\.?[,]?\s*limited|limited|ltd\.?|inc\.?|corp\.?|llc|labs?|studio|network|group|capital|tech|technology))(?=\s{2,}|\s+[\u4e00-\u9fff])/i,
    /^([A-Za-z][A-Za-z0-9.,&()'\-/ ]{1,80}?(?:company|co\.?[,]?\s*limited|limited|ltd\.?|inc\.?|corp\.?|llc|labs?|studio|network|group|capital|tech|technology))\s*[-|｜]/i,
  ];

  for (const pattern of companyLikePatterns) {
    const match = stripped.match(pattern);
    const candidate = clean(match?.[1]);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function guessCompanyFromBodyIntro(body: string): string | null {
  const headingMatch = body.match(/^(?:#{1,6}\s*)?(?:关于|About)\s+([^\n]{2,80})$/im);
  const headingCandidate = clean(headingMatch?.[1]);
  if (headingCandidate && !/^(?:我们|公司|团队|about)$/i.test(headingCandidate)) {
    return headingCandidate;
  }

  const introMatch = body.match(/^([A-Za-z][A-Za-z0-9.,&()'\-/ ]{1,60}|[\u4e00-\u9fffA-Za-z0-9·&\-.\s]{2,40})\s*(?:是(?:一家|一个|一间)|is\s+(?:an?|the))/m);
  const introCandidate = clean(introMatch?.[1]);
  if (introCandidate && !/^(?:我们|公司|团队)$/i.test(introCandidate)) {
    return introCandidate;
  }

  return null;
}

function guessWorkMode(title: string, body: string): string | null {
  const text = `${title}\n${body}`;
  const mode = text.match(/(?:remote|onsite|on-site|hybrid|可远程|远程在家办公|远程办公|远程|半远端|远端|居家办公|现场办公|线下办公|线下|坐班|混合办公)/i);
  return mode?.[0] ?? null;
}

function guessTimezone(body: string): string | null {
  const match = body.match(/(?:timezone|time\s*zone|时区)\s*[:：]?\s*([^\n]+)/i);
  return match?.[1]?.trim() ?? null;
}

function guessEmploymentType(title: string, body: string): string | null {
  const text = `${title}\n${body}`;
  if (/(?:是否全职|工作性质|Job Nature)[^\n]{0,20}(?:是|full[- ]?time|全职)/i.test(text)) {
    return "全职";
  }
  if (/(?:\bpart[- ]?time\b|兼职)/i.test(text)) {
    return "兼职";
  }
  if (/(?:\bintern\b|实习)/i.test(text)) {
    return "实习";
  }
  if (/(?:\bcontract\b|合同工|外包|顾问)/i.test(text)) {
    return "contract";
  }
  if (/(?:月休\d+天|工时\s*[:：])/i.test(text)) {
    return "全职";
  }
  const match = text.match(/\b(?:full[- ]?time|part[- ]?time|contract|intern)\b|兼职|全职|实习|外包|顾问/i);
  return match?.[0] ?? null;
}

function isRemote(workMode: string | null | undefined, title: string, body: string): boolean {
  const text = `${workMode ?? ""}\n${title}\n${body}`;
  if (/(?:onsite only|on-site only|仅线下|仅现场|不支持远程|非远程|是否远程\s*[:：]\s*(?:否|no|false)|全职线下|线下办公|现场办公)/i.test(text)) {
    return false;
  }
  return REMOTE_RE.test(text);
}

function choosePreferredSalary(...candidates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const compact = clean(candidate);
    if (!compact || !looksLikeSalarySnippet(compact)) {
      continue;
    }
    const score = scoreSalarySnippet(compact);
    if (score > bestScore) {
      best = compact;
      bestScore = score;
    }
  }

  return best;
}

function scoreSalarySnippet(value: string): number {
  let score = 0;
  if (/(competitive|negotiable|面议|open to discuss|tbd)/i.test(value)) {
    return 1;
  }
  if (/\d/.test(value)) {
    score += 4;
  }
  if (/(?:USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|TWD|[$¥￥]|港币|台币|元)/i.test(value)) {
    score += 2;
  }
  if (/(?:month|monthly|year|annual|week|day|hour|月|年|天|小时|时)/i.test(value)) {
    score += 1;
  }
  if (/(?:[-~–—至]|to|\+)/i.test(value)) {
    score += 1;
  }
  return score;
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
    /(?:[$¥￥]|USDT|USD|RMB|CNY|HKD|SGD|EUR|GBP|TWD)?\s*(\d[\d,.]*\s*[kKwW万千]?)(?:\s*[-~–—至]\s*|\s+to\s+)(?:[$¥￥]|USDT|USD|RMB|CNY|HKD|SGD|EUR|GBP|TWD)?\s*(\d[\d,.]*\s*[kKwW万千]?)/i,
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

function looksLikeSalarySnippet(value: string | null): boolean {
  if (!value) {
    return false;
  }

  if (/(?:whatsapp|telegram|tg|discord|wechat|phone|mobile|tel|contact|联系方式|电话|手机号)/i.test(value)) {
    return false;
  }

  const hasSalarySignal = /(?:salary|compensation|薪资|薪酬|薪水|月薪|年薪|USD|USDT|RMB|CNY|HKD|SGD|EUR|GBP|TWD|[$¥￥]|k\b|w\b|万|\/月|\/年|\/hour|\/hr|月|年|小时|时)/i.test(value);
  return hasSalarySignal;
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
  if (/(?:\/\s*|per\s*|每\s*)(?:month|mo|m\b|月)/i.test(text) || /月薪/i.test(text)) {
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
  const genericChannels = new Set<string>();

  const addChannel = (value: string | null | undefined) => {
    const compact = clean(value);
    if (compact) {
      channels.add(compact);
    }
  };

  const addGenericChannel = (value: string) => {
    genericChannels.add(value);
  };

  const emailMatches = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emailMatches) {
    addChannel(`email:${email}`);
  }

  const links = body.match(/https?:\/\/[^\s)]+/gi) ?? [];
  for (const url of links) {
    addChannel(url);
  }

  const taggedChannels: Array<[RegExp, string]> = [
    [/\btelegram\b|\bt\.me\//i, "telegram"],
    [/\bdiscord\b/i, "discord"],
    [/\bwechat\b|\bwx\b|\bvx\b|微信/i, "wechat"],
    [/\bx\b|twitter/i, "x"],
    [/\blinkedin\b/i, "linkedin"],
  ];

  for (const [pattern, name] of taggedChannels) {
    if (pattern.test(body)) {
      addGenericChannel(name);
    }
  }

  const handlePatterns: Array<[RegExp, string, (raw: string) => string]> = [
    [/(?:telegram|tg)\s*[-:：]?\s*@?([\w_]{3,})/gi, "telegram", (raw) => `telegram:@${raw.replace(/^@/, "")}`],
    [/(?:discord)\s*[-:：]?\s*([\w.-]{2,}#\d{4}|@[\w.-]{2,})/gi, "discord", (raw) => `discord:${raw}`],
    [/(?:wechat|微信|wx|vx|v)\s*[-:：]?\s*([A-Za-z][A-Za-z0-9_-]{4,})/gi, "wechat", (raw) => `wechat:${raw}`],
    [/(?:twitter|x)\s*[-:：]?\s*@([\w_]{3,})/gi, "x", (raw) => `x:@${raw.replace(/^@/, "")}`],
    [/(?:linkedin)\s*[-:：]?\s*@?([\w.-]{3,})/gi, "linkedin", (raw) => `linkedin:${raw.replace(/^@/, "")}`],
  ];

  for (const [pattern, channelName, formatter] of handlePatterns) {
    for (const match of body.matchAll(pattern)) {
      if (match[1]) {
        addChannel(formatter(match[1]));
        genericChannels.delete(channelName);
      }
    }
  }

  for (const match of body.matchAll(/(?:联系方式|联系|咨询|私讯|私聊|联系我|Contact(?:\s+me)?|Reach\s+out)\s*[:：-]?\s*@([\w._-]{3,})/gi)) {
    addChannel(`contact:@${match[1].replace(/^@/, "")}`);
  }

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/^@[\w._-]{3,}$/.test(line)) {
      addChannel(`contact:${line}`);
    }
  }

  for (const channel of genericChannels) {
    addChannel(channel);
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

function toLines(value?: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function joinRichTextLines(values: string[]): string | null {
  const lines = uniq(values);
  return lines.length ? lines.join("\n") : null;
}

function preferRicherText(primary: string | null | undefined, fallback: string | null | undefined): string | null {
  const a = clean(primary);
  const b = clean(fallback);
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
