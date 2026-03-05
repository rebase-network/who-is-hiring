# Who Is Hiring (TypeScript Pipeline)

This file supersedes setup/run/deploy instructions for the Node/TypeScript implementation while leaving the original `README.md` untouched.

## Quick Start

```bash
npm ci
npm test
GH_REPO=rebase-network/who-is-hiring GH_TOKEN=<github_token> npm run build:site
```

## Output

- `data/jobs.normalized.json` (all issues)
- `public/jobs.normalized.json` (open issues only)
- `public/index.html` (static site)

## Workflows

- `.github/workflows/issues-to-pages.yml`
  - Triggers: issue `opened`, `edited`, `reopened`, `closed`, `labeled`, `unlabeled`
  - Runs tests + TypeScript build script
  - Commits refreshed JSON/HTML
  - Deploys `public/` to GitHub Pages

## Optional LLM Cleanup

Set these in repository secrets/variables:

- Secret: `LLM_API_KEY`
- Variable: `LLM_MODEL` (optional)
- Variable: `LLM_API_URL` (optional)

Fail-safe behavior:

- Missing key -> skip cleanup
- API/network/response/schema error -> keep original normalized records
