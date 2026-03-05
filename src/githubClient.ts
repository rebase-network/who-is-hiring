import { githubIssueSchema, type GitHubIssue } from "./schemas.js";

type LabelPayload = {
  name: string;
};

export type GitHubIssueComment = {
  body: string | null;
  created_at: string;
  user: {
    type: string;
  };
};

export class GitHubClient {
  private readonly owner: string;
  private readonly name: string;

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

    [this.owner, this.name] = repo.split("/", 2);
  }

  async listIssues(state = "all"): Promise<GitHubIssue[]> {
    const perPage = 100;
    let page = 1;
    const rows: GitHubIssue[] = [];

    while (true) {
      const params = new URLSearchParams({
        state,
        per_page: String(perPage),
        page: String(page),
      });
      const payload = await this.requestJson<unknown[]>(`/issues?${params.toString()}`);

      if (!Array.isArray(payload)) {
        throw new Error("unexpected GitHub API response");
      }

      const issuesOnly = payload.filter((item) => !(item as { pull_request?: unknown }).pull_request);
      const parsedIssues = issuesOnly.map((item) => githubIssueSchema.parse(item));
      rows.push(...parsedIssues);

      if (payload.length < perPage) {
        break;
      }
      page += 1;
    }

    return rows;
  }

  async ensureLabelExists(name: string, color = "d4c5f9", description = "Issue is missing key hiring details"): Promise<void> {
    const labels = await this.requestJson<LabelPayload[]>("/labels?per_page=100");
    const exists = labels.some((label) => label.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      return;
    }

    await this.requestJson("/labels", {
      method: "POST",
      body: JSON.stringify({ name, color, description }),
    });
  }

  async addLabelToIssue(issueNumber: number, label: string): Promise<void> {
    await this.requestJson(`/issues/${issueNumber}/labels`, {
      method: "POST",
      body: JSON.stringify({ labels: [label] }),
    });
  }

  async listIssueComments(issueNumber: number): Promise<GitHubIssueComment[]> {
    return this.requestJson<GitHubIssueComment[]>(`/issues/${issueNumber}/comments?per_page=100`);
  }

  async createIssueComment(issueNumber: number, body: string): Promise<void> {
    await this.requestJson(`/issues/${issueNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`https://api.github.com/repos/${this.owner}/${this.name}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "who-is-hiring-builder",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API failed (${response.status})`);
    }

    return (await response.json()) as T;
  }
}
