from __future__ import annotations

import json
import urllib.parse
import urllib.request


class GitHubClient:
    def __init__(self, repo: str, token: str) -> None:
        if "/" not in repo:
            raise ValueError("repo must be in owner/name format")
        if not token:
            raise ValueError("missing GitHub token")
        self.repo = repo
        self.token = token

    def list_issues(self, state: str = "all") -> list[dict]:
        owner, name = self.repo.split("/", 1)
        per_page = 100
        page = 1
        rows: list[dict] = []

        while True:
            query = urllib.parse.urlencode({"state": state, "per_page": per_page, "page": page})
            url = f"https://api.github.com/repos/{owner}/{name}/issues?{query}"
            request = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": "who-is-hiring-builder",
                },
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))

            if not isinstance(payload, list):
                raise RuntimeError("unexpected GitHub API response")

            issues_only = [item for item in payload if "pull_request" not in item]
            rows.extend(issues_only)

            if len(payload) < per_page:
                break
            page += 1

        return rows
