import { GitHubClient } from "../src/githubClient.js";
import { enrichLowConfidenceRecords } from "../src/extraction.js";
import { issueToNormalized, issueToRich } from "../src/parser.js";

const DEFAULT_REPO = "rebase-network/who-is-hiring";
const DEFAULT_ISSUES = [1071, 1072, 1073, 1074, 1076, 1078];
const FIELDS: Array<keyof ReturnType<typeof issueToNormalized>> = [
  "company",
  "location",
  "salary",
  "work_mode",
  "employment_type",
  "responsibilities",
  "requirements",
  "contact_channels",
];

async function main() {
  const issueNumbers = process.argv.slice(2).map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
  const numbers = issueNumbers.length ? issueNumbers : DEFAULT_ISSUES;
  const repo = process.env.GH_REPO ?? DEFAULT_REPO;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("missing GH_TOKEN or GITHUB_TOKEN");
  }

  const client = new GitHubClient(repo, token);
  const issues = await Promise.all(numbers.map((number) => client.getIssue(number)));
  const rich = issues.map(issueToRich);
  const normalized = issues.map(issueToNormalized);

  const result = await enrichLowConfidenceRecords({
    normalized,
    rich,
    lowConfidenceThreshold: Number.parseInt(process.env.LOW_CONFIDENCE_THRESHOLD ?? "70", 10) || 70,
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

  for (const number of numbers) {
    const before = normalized.find((row) => row.number === number);
    const after = result.records.find((row) => row.number === number);
    const trace = result.traces.find((row) => row.number === number);
    if (!before || !after || !trace) {
      continue;
    }

    console.log(`\n===== ISSUE ${number} =====`);
    console.log(`title: ${after.title}`);
    console.log(`trace: route=${trace.route} attempted=${trace.llm_attempted} applied=${trace.llm_applied} result=${trace.llm_result}`);
    if (trace.llm_error) {
      console.log(`llm_error: ${trace.llm_error}`);
    }
    if (trace.fallback_reason) {
      console.log(`fallback_reason: ${trace.fallback_reason}`);
    }
    console.log(`merged_fields: ${trace.merged_fields.join(", ") || "-"}`);
    console.log(`score: ${before.completeness_score} -> ${after.completeness_score}`);

    for (const field of FIELDS) {
      const left = JSON.stringify(before[field] ?? null);
      const right = JSON.stringify(after[field] ?? null);
      if (left !== right) {
        console.log(`  ${String(field)}:`);
        console.log(`    before=${left}`);
        console.log(`    after =${right}`);
      }
    }

    const beforeMissing = JSON.stringify(before.missing_fields ?? []);
    const afterMissing = JSON.stringify(after.missing_fields ?? []);
    if (beforeMissing !== afterMissing) {
      console.log(`  missing_fields:`);
      console.log(`    before=${beforeMissing}`);
      console.log(`    after =${afterMissing}`);
    }

    const beforeWeak = JSON.stringify(before.weak_fields ?? []);
    const afterWeak = JSON.stringify(after.weak_fields ?? []);
    if (beforeWeak !== afterWeak) {
      console.log(`  weak_fields:`);
      console.log(`    before=${beforeWeak}`);
      console.log(`    after =${afterWeak}`);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
