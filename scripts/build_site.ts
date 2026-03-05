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
import { cleanupRecords } from "../src/llmCleanup.js";
import { issueToRich, richToNormalized } from "../src/parser.js";
import { normalizedPayloadSchema, richPayloadSchema, type NormalizedJob, type RichJob } from "../src/schemas.js";
import { buildIndex, buildJobDetailPage, buildRobots, buildSitemap, jobDetailPath } from "../src/site.js";

const FEEDBACK_STATE_PATH = "data/feedback-state.json";

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

  const client = new GitHubClient(repo, token);
  const issues = await client.listIssues("all");
  const rich = issues.map(issueToRich).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const normalized = rich.map(richToNormalized);
  const cleaned = await cleanupRecords(normalized);
  const cleanedByNumber = new Map(cleaned.map((job) => [job.number, job]));
  const richMerged: RichJob[] = rich.map((job) => {
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

  const feedbackConfig = resolveFeedbackConfig();
  const feedbackState = await loadFeedbackState(FEEDBACK_STATE_PATH);

  const labelLoopReport = await handleLowScoreLabeling({
    client,
    cleaned,
    feedbackConfig,
    feedbackState,
  });

  const generatedAt = process.env.GITHUB_RUN_ID ?? "local";
  const allPayload = normalizedPayloadSchema.parse({
    generated_at: generatedAt,
    repo,
    count: cleaned.length,
    jobs: cleaned,
  });
  const richAllPayload = richPayloadSchema.parse({
    generated_at: generatedAt,
    repo,
    count: richMerged.length,
    jobs: richMerged,
  });

  const activeJobs = cleaned.filter((job) => job.state === "open");
  const activeRichJobs = richMerged.filter((job) => job.state === "open");
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

  const qualitySummary = buildQualitySummary(cleaned, activeJobs, labelLoopReport);

  await mkdir("data", { recursive: true });
  await mkdir("public", { recursive: true });
  await mkdir("public/jobs", { recursive: true });

  await writeFile("data/jobs.normalized.json", `${JSON.stringify(allPayload, null, 2)}\n`, "utf8");
  await writeFile("data/jobs.rich.json", `${JSON.stringify(richAllPayload, null, 2)}\n`, "utf8");
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

async function handleLowScoreLabeling(params: {
  client: GitHubClient;
  cleaned: Awaited<ReturnType<typeof cleanupRecords>>;
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

function buildQualitySummary(allJobs: NormalizedJob[], openJobs: NormalizedJob[], labelLoop: LabelLoopReport) {
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
