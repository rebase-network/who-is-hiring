import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { GitHubClient } from "../src/githubClient.js";
import {
  buildLowScoreReminderComment,
  createInitialFeedbackState,
  evaluateLowScoreLabeling,
  hasRecentLowScoreReminderComment,
  NEEDS_INFO_LABEL,
  resolveFeedbackConfig,
  type FeedbackState,
} from "../src/feedback.js";
import { enrichLowConfidenceRecords, type IssueExtractionTrace } from "../src/extraction.js";
import { issueToRich } from "../src/parser.js";
import {
  normalizedPayloadSchema,
  richPayloadSchema,
  type NormalizedJob,
  type RichJob,
} from "../src/schemas.js";
import { buildIndex, buildJobDetailPage, buildRobots, buildSitemap, jobDetailPath } from "../src/site.js";

const FEEDBACK_STATE_PATH = "data/feedback-state.json";
const NORMALIZED_PATH = "data/jobs.normalized.json";
const RICH_PATH = "data/jobs.rich.json";

type BuildMode = "full" | "single-issue";

type LabelLoopReport = {
  mode: "label-and-comment";
  issue_number: number | null;
  decision_reason: string | null;
  should_ensure_label: boolean;
  should_add_label: boolean;
  should_schedule_reminder: boolean;
  posted_reminder: boolean;
  threshold: number;
  cooldown_hours: number;
};

type BuildContext = {
  mode: BuildMode;
  issueNumber: number | null;
};

type ExtractedRecords = {
  normalized: NormalizedJob[];
  rich: RichJob[];
  traces: IssueExtractionTrace[];
};

async function main(): Promise<void> {
  const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

  if (!repo) {
    throw new Error("GH_REPO or GITHUB_REPOSITORY is required");
  }
  if (!token) {
    throw new Error("GH_TOKEN or GITHUB_TOKEN is required");
  }

  const siteUrl = resolveSiteUrl(repo);
  const context = await resolveBuildContext();
  const client = new GitHubClient(repo, token);

  const records = context.mode === "single-issue" && context.issueNumber
    ? await buildSingleIssueRecords(client, context.issueNumber)
    : await buildFullRecords(client);

  const feedbackConfig = resolveFeedbackConfig();
  const feedbackState = await loadFeedbackState(FEEDBACK_STATE_PATH);

  const labelLoopReport = await handleLowScoreLabeling({
    client,
    cleaned: records.normalized,
    feedbackConfig,
    feedbackState,
  });

  const generatedAt = process.env.GITHUB_RUN_ID ?? "local";
  const allPayload = normalizedPayloadSchema.parse({
    generated_at: generatedAt,
    repo,
    count: records.normalized.length,
    jobs: records.normalized,
  });
  const richAllPayload = richPayloadSchema.parse({
    generated_at: generatedAt,
    repo,
    count: records.rich.length,
    jobs: records.rich,
  });

  const activeJobs = records.normalized.filter((job) => job.state === "open");
  const activeRichJobs = records.rich.filter((job) => job.state === "open");
  const publicPayload = normalizedPayloadSchema.parse({
    generated_at: generatedAt,
    repo,
    count: activeJobs.length,
    jobs: activeJobs,
  });
  const publicRichPayload = richPayloadSchema.parse({
    generated_at: generatedAt,
    repo,
    count: activeRichJobs.length,
    jobs: activeRichJobs,
  });

  const qualitySummary = buildQualitySummary(records.normalized, activeJobs, labelLoopReport, records.traces);

  await mkdir("data", { recursive: true });
  await mkdir("public", { recursive: true });
  await mkdir("public/jobs", { recursive: true });

  await writeFile(NORMALIZED_PATH, `${JSON.stringify(allPayload, null, 2)}\n`, "utf8");
  await writeFile(RICH_PATH, `${JSON.stringify(richAllPayload, null, 2)}\n`, "utf8");
  await writeFile("public/jobs.normalized.json", `${JSON.stringify(publicPayload, null, 2)}\n`, "utf8");
  await writeFile("public/jobs.rich.json", `${JSON.stringify(publicRichPayload, null, 2)}\n`, "utf8");
  await writeFile("public/index.html", buildIndex(activeJobs, repo, siteUrl), "utf8");
  await writeFile("public/sitemap.xml", buildSitemap(activeJobs, siteUrl), "utf8");
  await writeFile("public/robots.txt", buildRobots(siteUrl), "utf8");

  await syncDetailPages(activeRichJobs, repo, siteUrl);

  await writeFile(FEEDBACK_STATE_PATH, `${JSON.stringify(feedbackState, null, 2)}\n`, "utf8");
  await writeFile("data/quality-summary.json", `${JSON.stringify(qualitySummary, null, 2)}\n`, "utf8");
  await writeFile("public/quality-summary.json", `${JSON.stringify(qualitySummary, null, 2)}\n`, "utf8");
  await writeFile("data/quality-summary.md", `${toQualityMarkdown(qualitySummary)}\n`, "utf8");
}

async function buildFullRecords(client: GitHubClient): Promise<ExtractedRecords> {
  const issues = await client.listIssues("all");
  return extractFromIssues(issues.map(issueToRich));
}

async function buildSingleIssueRecords(client: GitHubClient, issueNumber: number): Promise<ExtractedRecords> {
  const [cachedNormalized, cachedRich, issue] = await Promise.all([
    loadCachedNormalized(),
    loadCachedRich(),
    client.getIssue(issueNumber),
  ]);

  if (!cachedNormalized || !cachedRich) {
    return buildFullRecords(client);
  }

  const extracted = await extractFromIssues([issueToRich(issue)]);
  const updatedNormalized = mergeByNumber(cachedNormalized, extracted.normalized[0]);
  const updatedRich = mergeByNumber(cachedRich, extracted.rich[0]);

  return {
    normalized: sortByNewest(updatedNormalized),
    rich: sortByNewest(updatedRich),
    traces: extracted.traces,
  };
}

async function extractFromIssues(richJobs: RichJob[]): Promise<ExtractedRecords> {
  const normalized = richJobs.map(toNormalized);
  const extraction = await enrichLowConfidenceRecords({ normalized, rich: richJobs });
  const cleaned = extraction.records;
  const cleanedByNumber = new Map(cleaned.map((job) => [job.number, job]));

  const richMerged: RichJob[] = richJobs.map((job) => {
    const compact = cleanedByNumber.get(job.number);
    if (!compact) {
      return job;
    }
    return {
      ...job,
      company: compact.company,
      location: compact.location,
      salary: compact.salary,
      salary_min: compact.salary_min,
      salary_max: compact.salary_max,
      salary_currency: compact.salary_currency,
      salary_period: compact.salary_period,
      remote: compact.remote,
      work_mode: compact.work_mode,
      timezone: compact.timezone,
      employment_type: compact.employment_type,
      summary: compact.summary,
      completeness_score: compact.completeness_score,
      completeness_grade: compact.completeness_grade,
      missing_fields: compact.missing_fields,
      contact_details: compact.contact_channels ?? job.contact_details,
    };
  });

  return {
    normalized: sortByNewest(cleaned),
    rich: sortByNewest(richMerged),
    traces: extraction.traces,
  };
}

function toNormalized(job: RichJob): NormalizedJob {
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
    responsibilities: job.responsibilities[0] ?? null,
    contact_channels: job.contact_details,
    completeness_score: job.completeness_score,
    completeness_grade: job.completeness_grade,
    missing_fields: job.missing_fields,
    state: job.state,
    labels: job.labels,
    created_at: job.created_at,
    updated_at: job.updated_at,
    closed_at: job.closed_at,
    summary: job.summary,
    author: job.author,
  };
}

async function resolveBuildContext(): Promise<BuildContext> {
  const explicitMode = (process.env.BUILD_MODE ?? "").trim().toLowerCase();
  if (explicitMode === "full") {
    return { mode: "full", issueNumber: null };
  }

  const issueNumber = await getIssueNumberFromEvent();
  if (process.env.GITHUB_EVENT_NAME === "issues" && issueNumber) {
    return { mode: "single-issue", issueNumber };
  }

  return { mode: "full", issueNumber: null };
}

async function loadCachedNormalized(): Promise<NormalizedJob[] | null> {
  try {
    const raw = await readFile(NORMALIZED_PATH, "utf8");
    return normalizedPayloadSchema.parse(JSON.parse(raw)).jobs;
  } catch {
    return null;
  }
}

async function loadCachedRich(): Promise<RichJob[] | null> {
  try {
    const raw = await readFile(RICH_PATH, "utf8");
    return richPayloadSchema.parse(JSON.parse(raw)).jobs;
  } catch {
    return null;
  }
}

function mergeByNumber<T extends { number: number }>(rows: T[], next: T | undefined): T[] {
  if (!next) {
    return rows;
  }

  const index = rows.findIndex((row) => row.number === next.number);
  if (index === -1) {
    return [...rows, next];
  }

  const copy = [...rows];
  copy[index] = next;
  return copy;
}

function sortByNewest<T extends { created_at?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

async function handleLowScoreLabeling(params: {
  client: GitHubClient;
  cleaned: NormalizedJob[];
  feedbackConfig: ReturnType<typeof resolveFeedbackConfig>;
  feedbackState: FeedbackState;
}): Promise<LabelLoopReport> {
  const issueNumber = await getIssueNumberFromEvent();
  if (!issueNumber) {
    return {
      mode: "label-and-comment",
      issue_number: null,
      decision_reason: null,
      should_ensure_label: false,
      should_add_label: false,
      should_schedule_reminder: false,
      posted_reminder: false,
      threshold: params.feedbackConfig.lowScoreThreshold,
      cooldown_hours: params.feedbackConfig.reminderCooldownHours,
    };
  }

  const issue = params.cleaned.find((row) => row.number === issueNumber);
  if (!issue) {
    return {
      mode: "label-and-comment",
      issue_number: issueNumber,
      decision_reason: "issue-not-found-in-cleaned",
      should_ensure_label: false,
      should_add_label: false,
      should_schedule_reminder: false,
      posted_reminder: false,
      threshold: params.feedbackConfig.lowScoreThreshold,
      cooldown_hours: params.feedbackConfig.reminderCooldownHours,
    };
  }

  const now = new Date();
  const comments = await params.client.listIssueComments(issueNumber);
  const hasRecentReminderComment = hasRecentLowScoreReminderComment({
    comments: comments.map((comment) => ({
      body: comment.body,
      created_at: comment.created_at,
      user_type: comment.user?.type,
    })),
    now,
    cooldownHours: params.feedbackConfig.reminderCooldownHours,
  });

  const decision = evaluateLowScoreLabeling({
    issueNumber,
    isOpen: issue.state === "open",
    labels: issue.labels,
    completeness: {
      score: issue.completeness_score,
      grade: issue.completeness_grade,
      missing_fields: issue.missing_fields,
    },
    config: params.feedbackConfig,
    state: params.feedbackState,
    now,
    hasRecentReminderComment,
  });

  if (decision.shouldEnsureLabel) {
    await params.client.ensureLabelExists(NEEDS_INFO_LABEL);
  }

  if (decision.shouldAddLabel) {
    await params.client.addLabelToIssue(issueNumber, NEEDS_INFO_LABEL);
  }

  let postedReminder = false;
  if (decision.shouldScheduleReminder) {
    const reminderBody = buildLowScoreReminderComment({
      score: issue.completeness_score,
      threshold: params.feedbackConfig.lowScoreThreshold,
      missingFields: issue.missing_fields,
    });
    await params.client.createIssueComment(issueNumber, reminderBody);
    postedReminder = true;

    const issueState = params.feedbackState.issues[String(issueNumber)];
    if (issueState) {
      issueState.last_reminded_at = now.toISOString();
    }
  }

  return {
    mode: "label-and-comment",
    issue_number: issueNumber,
    decision_reason: decision.reason,
    should_ensure_label: decision.shouldEnsureLabel,
    should_add_label: decision.shouldAddLabel,
    should_schedule_reminder: decision.shouldScheduleReminder,
    posted_reminder: postedReminder,
    threshold: params.feedbackConfig.lowScoreThreshold,
    cooldown_hours: params.feedbackConfig.reminderCooldownHours,
  };
}

function buildQualitySummary(
  allJobs: NormalizedJob[],
  openJobs: NormalizedJob[],
  labelLoop: LabelLoopReport,
  extractionTraces: IssueExtractionTrace[],
) {
  const byGrade: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  const missingCounts: Record<string, number> = {};
  let scoreTotal = 0;

  for (const job of openJobs) {
    byGrade[job.completeness_grade] = (byGrade[job.completeness_grade] ?? 0) + 1;
    scoreTotal += job.completeness_score;
    for (const field of job.missing_fields) {
      missingCounts[field] = (missingCounts[field] ?? 0) + 1;
    }
  }

  const avgScore = openJobs.length ? Number((scoreTotal / openJobs.length).toFixed(2)) : 0;
  const lowScore = openJobs.filter((job) => job.completeness_score < labelLoop.threshold);

  return {
    generated_at: new Date().toISOString(),
    totals: {
      all_jobs: allJobs.length,
      open_jobs: openJobs.length,
      average_score_open: avgScore,
      low_score_open: lowScore.length,
    },
    grade_distribution_open: byGrade,
    missing_field_counts_open: Object.fromEntries(
      Object.entries(missingCounts).sort((a, b) => b[1] - a[1]),
    ),
    low_score_examples: lowScore.slice(0, 20).map((job) => ({
      number: job.number,
      title: job.title,
      score: job.completeness_score,
      grade: job.completeness_grade,
      missing_fields: job.missing_fields,
      labels: job.labels,
    })),
    extraction_observability: {
      low_confidence_threshold: Number.parseInt(process.env.LOW_CONFIDENCE_THRESHOLD ?? "70", 10) || 70,
      total_issues: extractionTraces.length,
      low_confidence_issues: extractionTraces.filter((row) => row.low_confidence).length,
      llm_enriched_issues: extractionTraces.filter((row) => row.route === "llm-enriched").length,
      llm_fallback_issues: extractionTraces.filter((row) => row.route === "llm-fallback").length,
      per_issue: extractionTraces,
    },
    low_score_label_loop: labelLoop,
  };
}

function toQualityMarkdown(summary: ReturnType<typeof buildQualitySummary>): string {
  const gradeRows = Object.entries(summary.grade_distribution_open)
    .map(([grade, count]) => `- ${grade}: ${count}`)
    .join("\n");
  const missingRows = Object.entries(summary.missing_field_counts_open)
    .map(([field, count]) => `- ${field}: ${count}`)
    .join("\n");

  return [
    "# Quality Summary",
    "",
    `Generated: ${summary.generated_at}`,
    `Open jobs: ${summary.totals.open_jobs}`,
    `Average completeness score: ${summary.totals.average_score_open}`,
    `Low-score open jobs (< threshold): ${summary.totals.low_score_open}`,
    "",
    "## Grade Distribution (open jobs)",
    gradeRows || "- none",
    "",
    "## Missing Field Counts (open jobs)",
    missingRows || "- none",
    "",
    "## Extraction Observability",
    `- Low-confidence threshold: ${summary.extraction_observability.low_confidence_threshold}`,
    `- Total issues: ${summary.extraction_observability.total_issues}`,
    `- Low-confidence issues: ${summary.extraction_observability.low_confidence_issues}`,
    `- LLM-enriched issues: ${summary.extraction_observability.llm_enriched_issues}`,
    `- LLM-fallback issues: ${summary.extraction_observability.llm_fallback_issues}`,
    "",
    "## Low-score Label Loop",
    `- Mode: ${summary.low_score_label_loop.mode}`,
    `- Event issue: ${summary.low_score_label_loop.issue_number ?? "n/a"}`,
    `- Decision: ${summary.low_score_label_loop.decision_reason ?? "n/a"}`,
    `- Ensure label: ${summary.low_score_label_loop.should_ensure_label}`,
    `- Add label: ${summary.low_score_label_loop.should_add_label}`,
    `- Schedule reminder: ${summary.low_score_label_loop.should_schedule_reminder}`,
    `- Posted reminder: ${summary.low_score_label_loop.posted_reminder}`,
    `- Threshold: ${summary.low_score_label_loop.threshold}`,
    `- Cooldown hours: ${summary.low_score_label_loop.cooldown_hours}`,
  ].join("\n");
}

async function getIssueNumberFromEvent(): Promise<number | null> {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventName !== "issues" || !eventPath) {
    return null;
  }

  try {
    const raw = JSON.parse(await readFile(eventPath, "utf8"));
    const number = raw?.issue?.number;
    return Number.isInteger(number) ? number : null;
  } catch {
    return null;
  }
}

async function loadFeedbackState(path: string): Promise<FeedbackState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as FeedbackState;
    if (!parsed || typeof parsed !== "object" || typeof parsed.issues !== "object") {
      return createInitialFeedbackState();
    }
    return parsed;
  } catch {
    return createInitialFeedbackState();
  }
}

function resolveSiteUrl(repo: string): string {
  const configured = (process.env.SITE_URL ?? "").trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const [owner, name] = repo.split("/");
  if (owner && name) {
    return `https://${owner}.github.io/${name}`;
  }

  throw new Error(`Unable to resolve site URL from repo: ${repo}`);
}

async function syncDetailPages(jobs: RichJob[], repo: string, siteUrl: string): Promise<void> {
  const detailDir = "public/jobs";
  const keep = new Set<string>();

  for (const job of jobs) {
    const relPath = jobDetailPath(job.number);
    const outputPath = `public/${relPath}`;
    keep.add(`${job.number}.html`);
    await writeFile(outputPath, buildJobDetailPage(job, repo, siteUrl), "utf8");
  }

  const existing = await readdir(detailDir, { withFileTypes: true });
  await Promise.all(
    existing
      .filter((entry) => entry.isFile() && entry.name.endsWith(".html") && !keep.has(entry.name))
      .map((entry) => rm(`${detailDir}/${entry.name}`)),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
