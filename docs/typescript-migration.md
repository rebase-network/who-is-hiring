# TypeScript Migration Guide

`README.md` is intentionally untouched. This document contains all TypeScript pipeline setup and operations.

## Overview

The issue-driven pipeline is now implemented in TypeScript/Node only:

1. Fetch all repository issues
2. Parse/normalize issue content into typed job records
3. Optionally run LLM cleanup (with fail-safe fallback)
4. Build JSON snapshots and static `public/index.html`
5. Deploy to GitHub Pages from `public/`

## Event Triggers

Workflow: `.github/workflows/issues-to-pages.yml`

Only issue events are enabled:

- `opened`
- `edited`
- `reopened`
- `closed`
- `labeled`
- `unlabeled`

No schedule trigger.

## Local Setup

```bash
npm ci
npm test
GH_REPO=rebase-network/who-is-hiring GH_TOKEN=<github_token> npm run build:site
```

Generated files:

- `data/jobs.normalized.json`
- `public/jobs.normalized.json`
- `public/index.html`

## Environment Variables

Required for build:

- `GH_REPO` or `GITHUB_REPOSITORY`
- `GH_TOKEN` or `GITHUB_TOKEN`

Optional LLM cleanup:

- `LLM_API_KEY` (if missing, cleanup is skipped)
- `LLM_MODEL` (default `gpt-5`)
- `LLM_API_URL` (default `https://api.openai.com/v1/responses`)
- `LLM_API_TYPE` (default `openai-responses`)
- `LLM_EXTRACTION_MODE` (`llm-first` or `low-confidence`; build flow should set `llm-first`)

If LLM call fails or returns invalid payload, original normalized records are used.

## GitHub Pages / Actions Setup

1. Enable GitHub Pages with source = GitHub Actions.
2. Ensure workflow permissions include `contents: write`, `pages: write`, `id-token: write`.
3. Optionally add secret `LLM_API_KEY`.
4. Optionally add repository variables `LLM_MODEL` and `LLM_API_URL`.

## Tests

- Parser/normalizer: `tests/parser.test.ts`
- LLM fallback path: `tests/llmCleanup.test.ts`
