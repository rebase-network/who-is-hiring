import { mkdir, readFile, writeFile } from "node:fs/promises";
import { GitHubClient } from "../src/githubClient.js";
import {
  createInitialFeedbackState,
  evaluateLowScoreLabeling,
  NEEDS_INFO_LABEL,
  resolveFeedbackConfig,
  type FeedbackState,
} from "../src/feedback.js";
import { cleanupRecords } from "../src/llmCleanup.js";
import { issueToNormalized } from "../src/parser.js";
import { normalizedPayloadSchema, type NormalizedJob } from "../src/schemas.js";
import { buildIndex } from "../src/site.js";

const FEEDBACK_STATE_PATH = "data/feedback-state.json";

type LabelLoopReport = {
  mode: "label-only";
  issue_number: number | null;
  decision_reason: string | null;
  should_ensure_label: boolean;
  should_add_label: boolean;
  should_schedule_reminder: boolean;
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

  const client = new GitHubClient(repo, token);
  const issues = await client.listIssues("all");
  const normalized = issues.map(issueToNormalized).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const cleaned = await cleanupRecords(normalized);

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

  const activeJobs = cleaned.filter((job) => job.state === "open");
  const publicPayload = normalizedPayloadSchema.parse({
    generated_at: generatedAt,
    repo,
    count: activeJobs.length,
    jobs: activeJobs,
  });

  const qualitySummary = buildQualitySummary(cleaned, activeJobs, labelLoopReport);

  await mkdir("data", { recursive: true });
  await mkdir("public", { recursive: true });

  await writeFile("data/jobs.normalized.json", `${JSON.stringify(allPayload, null, 2)}\n`, "utf8");
  await writeFile("public/jobs.normalized.json", `${JSON.stringify(publicPayload, null, 2)}\n`, "utf8");
  await writeFile("public/index.html", buildIndex(activeJobs, repo), "utf8");
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
      mode: "label-only",
      issue_number: null,
      decision_reason: null,
      should_ensure_label: false,
      should_add_label: false,
      should_schedule_reminder: false,
      threshold: params.feedbackConfig.lowScoreThreshold,
      cooldown_hours: params.feedbackConfig.reminderCooldownHours,
    };
  }

  const issue = params.cleaned.find((row) => row.number === issueNumber);
  if (!issue) {
    return {
      mode: "label-only",
      issue_number: issueNumber,
      decision_reason: "issue-not-found-in-cleaned",
      should_ensure_label: false,
      should_add_label: false,
      should_schedule_reminder: false,
      threshold: params.feedbackConfig.lowScoreThreshold,
      cooldown_hours: params.feedbackConfig.reminderCooldownHours,
    };
  }

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
    now: new Date(),
  });

  if (decision.shouldEnsureLabel) {
    await params.client.ensureLabelExists(NEEDS_INFO_LABEL);
  }

  if (decision.shouldAddLabel) {
    await params.client.addLabelToIssue(issueNumber, NEEDS_INFO_LABEL);
  }

  return {
    mode: "label-only",
    issue_number: issueNumber,
    decision_reason: decision.reason,
    should_ensure_label: decision.shouldEnsureLabel,
    should_add_label: decision.shouldAddLabel,
    should_schedule_reminder: decision.shouldScheduleReminder,
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
    `- Schedule reminder (observed only): ${summary.low_score_label_loop.should_schedule_reminder}`,
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
