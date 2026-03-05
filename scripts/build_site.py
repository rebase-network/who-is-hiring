#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from wih.github_client import GitHubClient
from wih.llm_cleanup import cleanup_records
from wih.parser import issue_to_normalized
from wih.site import build_index


def main() -> None:
    repo = os.getenv("GH_REPO") or os.getenv("GITHUB_REPOSITORY")
    token = os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN")
    if not repo:
        raise SystemExit("GH_REPO or GITHUB_REPOSITORY is required")
    if not token:
        raise SystemExit("GH_TOKEN or GITHUB_TOKEN is required")

    issues = GitHubClient(repo=repo, token=token).list_issues(state="all")
    normalized = [issue_to_normalized(issue) for issue in issues]
    normalized.sort(key=lambda row: row.get("created_at") or "", reverse=True)

    cleaned = cleanup_records(normalized)

    data_dir = Path("data")
    public_dir = Path("public")
    data_dir.mkdir(parents=True, exist_ok=True)
    public_dir.mkdir(parents=True, exist_ok=True)

    payload = {
        "generated_at": os.getenv("GITHUB_RUN_ID") or "local",
        "repo": repo,
        "count": len(cleaned),
        "jobs": cleaned,
    }
    (data_dir / "jobs.normalized.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    active = [job for job in cleaned if job.get("state") == "open"]
    public_payload = {
        "generated_at": payload["generated_at"],
        "repo": repo,
        "count": len(active),
        "jobs": active,
    }

    (public_dir / "jobs.normalized.json").write_text(
        json.dumps(public_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (public_dir / "index.html").write_text(build_index(active, repo), encoding="utf-8")


if __name__ == "__main__":
    main()
