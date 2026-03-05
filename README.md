[![Twitter](https://img.shields.io/twitter/url?label=Rebase&url=https%3A%2F%2Ftwitter.com%2FRebaseCommunity)](https://twitter.com/RebaseCommunity)

## Who is hiring

Rebase maintains this repository to help teams publish hiring information through GitHub Issues.

### How posting works (unchanged)

1. Create a new issue in this repository with your job description.
2. Edit/reopen/close/label the issue when the role changes.
3. GitHub Actions will regenerate the JSON dataset and static site from issues.

The issue-based posting flow stays the same: issues are still the source of truth.

## Data + site pipeline

This repository now includes an event-driven pipeline for GitHub Pages:

- Fetch all issues from `rebase-network/who-is-hiring`
- Parse each issue into normalized job fields
- Optionally run an LLM cleanup pass (if API key is configured)
- Generate:
  - `data/jobs.normalized.json` (committed snapshot)
  - `public/jobs.normalized.json` (site data)
  - `public/index.html` (jobs board)
- Deploy `public/` to GitHub Pages

### Triggers (no schedule)

Workflow: `.github/workflows/issues-to-pages.yml`

Triggers:

- `issues.opened`
- `issues.edited`
- `issues.reopened`
- `issues.closed`
- `issues.labeled`
- `issues.unlabeled`
- Manual `workflow_dispatch`

No cron schedule is configured.

## Local development

```bash
python -m pip install -U pip pytest
pytest -q
GH_REPO=rebase-network/who-is-hiring GH_TOKEN=<github_token> python scripts/build_site.py
```

Output files:

- `data/jobs.normalized.json`
- `public/jobs.normalized.json`
- `public/index.html`

## LLM cleanup hook (optional)

The builder can post-process normalized records with an LLM.

Environment variables:

- `LLM_API_KEY` (secret; optional)
- `LLM_MODEL` (optional, default `gpt-4.1-mini`)
- `LLM_API_URL` (optional, default `https://api.openai.com/v1/responses`)

Fail-safe behavior:

- If `LLM_API_KEY` is missing, cleanup is skipped.
- If the LLM request fails or returns invalid JSON, original normalized records are used.

## Required repo setup

1. Enable **GitHub Pages** and set source to **GitHub Actions**.
2. Ensure workflow permissions allow writing to repository contents.
3. Optional: add repository secret `LLM_API_KEY` for cleanup.
4. Optional: set repository variables `LLM_MODEL` and `LLM_API_URL`.

## Testing

Parser/normalizer tests live in:

- `tests/test_parser.py`
- `tests/test_llm_cleanup.py`

## Other recruitment platforms

- https://cryptocurrencyjobs.co/
- https://sailonchain.com/
- https://angel.co/candidates/overview
- https://cryptojobslist.com/
- https://vuejobs.com/

## Disclaimer

All job information is posted by employers. Rebase only helps with curation and presentation and is not responsible for legal compliance or authenticity.

## 联系人

如遇问题，可联系社区负责招聘信息发布的同学。(wx: xxzj_preeminent)

---

[往期工作机会](./jobs.md)
