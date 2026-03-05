import { githubIssueSchema, type GitHubIssue } from "./schemas.js";

export class GitHubClient {
  constructor(
    private readonly repo: string,
    private readonly token: string,
  ) {
    if (!repo.includes("/")) {
      throw new Error("repo must be in owner/name format");
    }
    if (!token) {
      throw new Error("missing GitHub token");
    }
  }

  async listIssues(state = "all"): Promise<GitHubIssue[]> {
    const [owner, name] = this.repo.split("/", 2);
    const perPage = 100;
    let page = 1;
    const rows: GitHubIssue[] = [];

    while (true) {
      const params = new URLSearchParams({
        state,
        per_page: String(perPage),
        page: String(page),
      });
      const url = `https://api.github.com/repos/${owner}/${name}/issues?${params.toString()}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "who-is-hiring-builder",
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API failed (${response.status})`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("unexpected GitHub API response");
      }

      const issuesOnly = payload.filter((item) => !item.pull_request);
      const parsedIssues = issuesOnly.map((item) => githubIssueSchema.parse(item));
      rows.push(...parsedIssues);

      if (payload.length < perPage) {
        break;
      }
      page += 1;
    }

    return rows;
  }
}
