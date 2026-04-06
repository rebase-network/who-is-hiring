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
import { isLikelyHiringRichJob, issueToRich } from "../src/parser.js";
import {
  normalizedPayloadSchema,
  richPayloadSchema,
  type NormalizedJob,
  type RichJob,
} from "../src/schemas.js";
import { stabilizeRssTimestamps } from "../src/rss.js";
import { buildIndex, buildJobDetailPage, buildRobots, buildRssFeed, buildSitemap, jobDetailPath } from "../src/site.js";

const FEEDBACK_STATE_PATH = "data/feedback-state.json";
const NORMALIZED_PATH = "data/jobs.normalized.json";
const RICH_PATH = "data/jobs.rich.json";

type BuildMode = "full" | "single-issue";

type LabelLoopReport = {
  mode: "label-and-comment";
  issue_number: number | null;
  decision_reason: string | null;
  reminder_band: "strong" | "moderate" | "comment-sync" | null;
  should_ensure_label: boolean;
  should_add_label: boolean;
  should_remove_label: boolean;
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

function logProgress(step: string, detail?: string): void {
  process.stdout.write(`[build_site] ${step}${detail ? ` ${detail}` : ""}\n`);
}

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
  await mkdir("state", { recursive: true });
  if (!process.env.LLM_CACHE_PATH) {
    process.env.LLM_CACHE_PATH = "state/llm-enrich-cache.json";
  }
  const client = new GitHubClient(repo, token);
  const buildGeneratedAt = new Date().toISOString();
  const previousNormalized = await loadCachedNormalized();

  logProgress("start", `mode=${context.mode} issueNumber=${context.issueNumber ?? "n/a"} siteUrl=${siteUrl}`);
  logProgress(
    context.mode === "single-issue" ? "collect-records" : "collect-records",
    context.mode === "single-issue" ? `issue=${context.issueNumber}` : "full-rebuild",
  );

  const records = context.mode === "single-issue" && context.issueNumber
    ? await buildSingleIssueRecords(client, context.issueNumber)
    : await buildFullRecords(client);

  logProgress("records-ready", `normalized=${records.normalized.length} rich=${records.rich.length} traces=${records.traces.length}`);

  const feedbackConfig = resolveFeedbackConfig();
  const feedbackState = await loadFeedbackState(FEEDBACK_STATE_PATH);

  const normalizedWithStableRss = stabilizeRssTimestamps(records.normalized, previousNormalized, buildGeneratedAt);

  const labelLoopReport = await handleLowScoreLabeling({
    client,
    cleaned: normalizedWithStableRss,
    feedbackConfig,
    feedbackState,
  });

  const generatedAt = process.env.GITHUB_RUN_ID ?? "local";
  const allPayload = normalizedPayloadSchema.parse({
    generated_at: generatedAt,
    repo,
    count: normalizedWithStableRss.length,
    jobs: normalizedWithStableRss,
  });
  const richAllPayload = richPayloadSchema.parse({
    generated_at: generatedAt,
    repo,
    count: records.rich.length,
    jobs: records.rich,
  });

  const activeJobs = normalizedWithStableRss.filter((job) => isOpenIssue(job.state));
  const activeRichJobs = records.rich.filter((job) => isOpenIssue(job.state));
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

  const lowConfidenceCount = records.traces.filter((trace) => trace.low_confidence).length;
  const batchSizeRaw = Number.parseInt(process.env.LLM_BATCH_SIZE ?? "10", 10);
  const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? batchSizeRaw : 10;
  const batchCount = Math.ceil(lowConfidenceCount / batchSize);

  logProgress("extraction-summary", `records=${records.normalized.length} lowConfidenceRecords=${lowConfidenceCount} llmBatchCount=${batchCount}`);

  const qualitySummary = buildQualitySummary(records.normalized, activeJobs, labelLoopReport, records.traces);

  logProgress("prepare-output-dirs", "data public public/jobs");
  await mkdir("data", { recursive: true });
  await mkdir("public", { recursive: true });
  await mkdir("public/jobs", { recursive: true });

  logProgress("write-artifacts", `openJobs=${activeJobs.length} openDetailPages=${activeRichJobs.length}`);
  await writeFile(NORMALIZED_PATH, `${JSON.stringify(allPayload, null, 2)}\n`, "utf8");
  await writeFile(RICH_PATH, `${JSON.stringify(richAllPayload, null, 2)}\n`, "utf8");
  await writeFile("public/jobs.normalized.json", `${JSON.stringify(publicPayload, null, 2)}\n`, "utf8");
  await writeFile("public/jobs.rich.json", `${JSON.stringify(publicRichPayload, null, 2)}\n`, "utf8");
  await writeFile("public/index.html", buildIndex(activeJobs, repo, siteUrl), "utf8");
  await writeFile("public/feed.xml", buildRssFeed(activeJobs, repo, siteUrl, buildGeneratedAt), "utf8");
  await writeFile("public/sitemap.xml", buildSitemap(activeJobs, siteUrl), "utf8");
  await writeFile("public/robots.txt", buildRobots(siteUrl), "utf8");

  const detailPageSummary = await syncDetailPages(activeRichJobs, repo, siteUrl);
  logProgress("detail-pages-ready", `written=${detailPageSummary.written} removed=${detailPageSummary.removed}`);

  await writeFile(FEEDBACK_STATE_PATH, `${JSON.stringify(feedbackState, null, 2)}\n`, "utf8");
  await writeFile("data/quality-summary.json", `${JSON.stringify(qualitySummary, null, 2)}\n`, "utf8");
  await writeFile("public/quality-summary.json", `${JSON.stringify(qualitySummary, null, 2)}\n`, "utf8");
  await writeFile("data/quality-summary.md", `${toQualityMarkdown(qualitySummary)}\n`, "utf8");
  logProgress("done", `siteUrl=${siteUrl} generatedAt=${buildGeneratedAt}`);
}

async function buildFullRecords(client: GitHubClient): Promise<ExtractedRecords> {
  logProgress("fetch-issues", "state=all");
  const issues = await client.listIssues("all");
  logProgress("issues-fetched", `count=${issues.length}`);
  const richJobs = issues.map(issueToRich).filter(isLikelyHiringRichJob);
  logProgress("issues-filtered", `hiringOnly=${richJobs.length}`);
  return extractFromIssues(richJobs, client);
}

async function buildSingleIssueRecords(client: GitHubClient, issueNumber: number): Promise<ExtractedRecords> {
  logProgress("load-single-issue-inputs", `issue=${issueNumber}`);
  const [cachedNormalized, cachedRich, issue] = await Promise.all([
    loadCachedNormalized(),
    loadCachedRich(),
    client.getIssue(issueNumber),
  ]);

  if (!cachedNormalized || !cachedRich) {
    throw new Error(
      "Single-issue mode requires cached data files. Run manual full rebuild workflow once before issue-triggered incremental builds.",
    );
  }

  logProgress("single-issue-inputs-ready", `cachedNormalized=${cachedNormalized.length} cachedRich=${cachedRich.length}`);
  const richIssue = issueToRich(issue);
  if (!isLikelyHiringRichJob(richIssue)) {
    return {
      normalized: sortByNewest(removeByNumber(cachedNormalized, issueNumber)),
      rich: sortByNewest(removeByNumber(cachedRich, issueNumber)),
      traces: [],
    };
  }

  const extracted = await extractFromIssues([richIssue], client);
  const updatedNormalized = mergeByNumber(cachedNormalized, extracted.normalized[0]);
  const updatedRich = mergeByNumber(cachedRich, extracted.rich[0]);

  return {
    normalized: sortByNewest(updatedNormalized),
    rich: sortByNewest(updatedRich),
    traces: extracted.traces,
  };
}

async function extractFromIssues(richJobs: RichJob[], client: GitHubClient): Promise<ExtractedRecords> {
  logProgress("normalize-records", `count=${richJobs.length}`);
  const normalized = richJobs.map(toNormalized);
  const extractionMode = (process.env.LLM_EXTRACTION_MODE?.trim().toLowerCase() === "low-confidence" ? "low-confidence" : "llm-first") as "llm-first" | "low-confidence";
  logProgress("enrich-llm-start", `count=${normalized.length} mode=${extractionMode}`);
  const extraction = await enrichLowConfidenceRecords({
    normalized,
    rich: richJobs,
    extractionMode,
    loadComments: async (issueNumber) => {
      const comments = await client.listIssueComments(issueNumber);
      return comments.map((comment) => ({
        body: comment.body,
        author: comment.user?.login ?? null,
        created_at: comment.created_at ?? null,
        updated_at: comment.updated_at ?? null,
      }));
    },
  });
  const cleaned = extraction.records;
  logProgress("enrich-low-confidence-done", `count=${cleaned.length}`);
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
      requirements: compact.requirements ? [compact.requirements] : job.requirements,
      completeness_score: compact.completeness_score,
      completeness_grade: compact.completeness_grade,
      missing_fields: compact.missing_fields,
      weak_fields: compact.weak_fields,
      risk_flags: compact.risk_flags,
      score_breakdown: compact.score_breakdown,
      field_sources: compact.field_sources,
      comment_supplemented_fields: compact.comment_supplemented_fields,
      decision_value_score: compact.decision_value_score,
      credibility_score: compact.credibility_score,
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

function removeByNumber<T extends { number: number }>(rows: T[], issueNumber: number): T[] {
  return rows.filter((row) => row.number !== issueNumber);
}

function sortByNewest<T extends { created_at?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

function joinRichTextLines(values: string[]): string | null {
  const lines = Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
  return lines.length ? lines.join("\n") : null;
}

function isOpenIssue(state: string | null | undefined): boolean {
  return String(state ?? "").toLowerCase() === "open";
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
      reminder_band: null,
      should_ensure_label: false,
      should_add_label: false,
      should_remove_label: false,
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
      reminder_band: null,
      should_ensure_label: false,
      should_add_label: false,
      should_remove_label: false,
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
    isOpen: isOpenIssue(issue.state),
    labels: issue.labels,
    completeness: {
      score: issue.completeness_score,
      grade: issue.completeness_grade,
      missing_fields: issue.missing_fields,
      risk_flags: issue.risk_flags ?? [],
    },
    config: params.feedbackConfig,
    state: params.feedbackState,
    now,
    hasRecentReminderComment,
    hasCommentSupplementedFields: (issue.comment_supplemented_fields ?? []).length > 0,
  });

  if (decision.shouldEnsureLabel) {
    await params.client.ensureLabelExists(NEEDS_INFO_LABEL);
  }

  if (decision.shouldAddLabel) {
    await params.client.addLabelToIssue(issueNumber, NEEDS_INFO_LABEL);
  }

  if (decision.shouldRemoveLabel) {
    await params.client.removeLabelFromIssue(issueNumber, NEEDS_INFO_LABEL);
  }

  let postedReminder = false;
  if (decision.shouldScheduleReminder) {
    const reminderBody = buildLowScoreReminderComment({
      score: issue.completeness_score,
      threshold: params.feedbackConfig.lowScoreThreshold,
      missingFields: issue.missing_fields,
      weakFields: issue.weak_fields ?? [],
      commentSupplementedFields: issue.comment_supplemented_fields ?? [],
      reminderBand: decision.reminderBand,
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
    reminder_band: decision.reminderBand,
    should_ensure_label: decision.shouldEnsureLabel,
    should_add_label: decision.shouldAddLabel,
    should_remove_label: decision.shouldRemoveLabel,
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
  const weakCounts: Record<string, number> = {};
  const riskCounts: Record<string, number> = {};
  let scoreTotal = 0;
  let decisionValueTotal = 0;
  let credibilityTotal = 0;
  let commentSupplementedIssues = 0;

  for (const job of openJobs) {
    byGrade[job.completeness_grade] = (byGrade[job.completeness_grade] ?? 0) + 1;
    scoreTotal += job.completeness_score;
    decisionValueTotal += job.decision_value_score ?? 0;
    credibilityTotal += job.credibility_score ?? 0;
    if ((job.comment_supplemented_fields ?? []).length > 0) {
      commentSupplementedIssues += 1;
    }
    for (const field of job.missing_fields) {
      missingCounts[field] = (missingCounts[field] ?? 0) + 1;
    }
    for (const field of job.weak_fields ?? []) {
      weakCounts[field] = (weakCounts[field] ?? 0) + 1;
    }
    for (const risk of job.risk_flags ?? []) {
      riskCounts[risk] = (riskCounts[risk] ?? 0) + 1;
    }
  }

  const avgScore = openJobs.length ? Number((scoreTotal / openJobs.length).toFixed(2)) : 0;
  const avgDecisionValue = openJobs.length ? Number((decisionValueTotal / openJobs.length).toFixed(2)) : 0;
  const avgCredibility = openJobs.length ? Number((credibilityTotal / openJobs.length).toFixed(2)) : 0;
  const lowScore = openJobs.filter((job) => job.completeness_score < labelLoop.threshold);

  return {
    generated_at: new Date().toISOString(),
    totals: {
      all_jobs: allJobs.length,
      open_jobs: openJobs.length,
      average_score_open: avgScore,
      average_decision_value_open: avgDecisionValue,
      average_credibility_open: avgCredibility,
      low_score_open: lowScore.length,
      comment_supplemented_open: commentSupplementedIssues,
    },
    grade_distribution_open: byGrade,
    missing_field_counts_open: Object.fromEntries(
      Object.entries(missingCounts).sort((a, b) => b[1] - a[1]),
    ),
    weak_field_counts_open: Object.fromEntries(
      Object.entries(weakCounts).sort((a, b) => b[1] - a[1]),
    ),
    risk_flag_counts_open: Object.fromEntries(
      Object.entries(riskCounts).sort((a, b) => b[1] - a[1]),
    ),
    low_score_examples: lowScore.slice(0, 20).map((job) => ({
      number: job.number,
      title: job.title,
      score: job.completeness_score,
      grade: job.completeness_grade,
      missing_fields: job.missing_fields,
      weak_fields: job.weak_fields ?? [],
      risk_flags: job.risk_flags ?? [],
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
    `Average decision value score: ${summary.totals.average_decision_value_open}`,
    `Average credibility score: ${summary.totals.average_credibility_open}`,
    `Low-score open jobs (< threshold): ${summary.totals.low_score_open}`,
    `Comment-supplemented open jobs: ${summary.totals.comment_supplemented_open}`,
    "",
    "## Grade Distribution (open jobs)",
    gradeRows || "- none",
    "",
    "## Missing Field Counts (open jobs)",
    missingRows || "- none",
    "",
    "## Weak Field Counts (open jobs)",
    Object.entries(summary.weak_field_counts_open).map(([field, count]) => `- ${field}: ${count}`).join("\n") || "- none",
    "",
    "## Risk Flag Counts (open jobs)",
    Object.entries(summary.risk_flag_counts_open).map(([field, count]) => `- ${field}: ${count}`).join("\n") || "- none",
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
    `- Reminder band: ${summary.low_score_label_loop.reminder_band ?? "n/a"}`,
    `- Ensure label: ${summary.low_score_label_loop.should_ensure_label}`,
    `- Add label: ${summary.low_score_label_loop.should_add_label}`,
    `- Remove label: ${summary.low_score_label_loop.should_remove_label}`,
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

async function syncDetailPages(jobs: RichJob[], repo: string, siteUrl: string): Promise<{ written: number; removed: number }> {
  const detailDir = "public/jobs";
  const keep = new Set<string>();

  for (const job of jobs) {
    const relPath = jobDetailPath(job.number);
    const outputPath = `public/${relPath}`;
    keep.add(`${job.number}.html`);
    await writeFile(outputPath, buildJobDetailPage(job, repo, siteUrl), "utf8");
  }

  const existing = await readdir(detailDir, { withFileTypes: true });
  const staleEntries = existing
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html") && !keep.has(entry.name));
  await Promise.all(staleEntries.map((entry) => rm(`${detailDir}/${entry.name}`)));

  return {
    written: jobs.length,
    removed: staleEntries.length,
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
