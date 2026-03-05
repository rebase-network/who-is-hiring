import { mkdir, writeFile } from "node:fs/promises";
import { GitHubClient } from "../src/githubClient.js";
import { cleanupRecords } from "../src/llmCleanup.js";
import { issueToNormalized } from "../src/parser.js";
import { normalizedPayloadSchema } from "../src/schemas.js";
import { buildIndex } from "../src/site.js";

async function main(): Promise<void> {
  const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

  if (!repo) {
    throw new Error("GH_REPO or GITHUB_REPOSITORY is required");
  }
  if (!token) {
    throw new Error("GH_TOKEN or GITHUB_TOKEN is required");
  }

  const issues = await new GitHubClient(repo, token).listIssues("all");
  const normalized = issues.map(issueToNormalized).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const cleaned = await cleanupRecords(normalized);

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
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
