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
import { normalizedPayloadSchema } from "../src/schemas.js";
import { buildIndex } from "../src/site.js";

const FEEDBACK_STATE_PATH = "data/feedback-state.json";

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

  await handleLowScoreLabeling({
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

  await mkdir("data", { recursive: true });
  await mkdir("public", { recursive: true });

  await writeFile("data/jobs.normalized.json", `${JSON.stringify(allPayload, null, 2)}\n`, "utf8");
  await writeFile("public/jobs.normalized.json", `${JSON.stringify(publicPayload, null, 2)}\n`, "utf8");
  await writeFile("public/index.html", buildIndex(activeJobs, repo), "utf8");
  await writeFile(FEEDBACK_STATE_PATH, `${JSON.stringify(feedbackState, null, 2)}\n`, "utf8");
}

async function handleLowScoreLabeling(params: {
  client: GitHubClient;
  cleaned: Awaited<ReturnType<typeof cleanupRecords>>;
  feedbackConfig: ReturnType<typeof resolveFeedbackConfig>;
  feedbackState: FeedbackState;
}): Promise<void> {
  const issueNumber = await getIssueNumberFromEvent();
  if (!issueNumber) {
    return;
  }

  const issue = params.cleaned.find((row) => row.number === issueNumber);
  if (!issue) {
    return;
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
