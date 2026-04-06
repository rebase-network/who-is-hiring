# Local Full Build Runbook

Use this runbook for the full local processing flow.

Why local-first:

- Full LLM enrichment is too slow and fragile for normal GitHub Actions runs.
- Large low-confidence batches can hit CI time limits or get canceled.
- Local runs can use resumable cache in `state/llm-enrich-cache.json` and recover from interruptions.

## 1. Sync latest code

```bash
git fetch origin
git pull --ff-only origin main
```

If you are using a feature branch, pull the correct branch instead of `main`.

## 2. Export required env vars

Set the repository and live LLM relay configuration in your shell.

```bash
export GH_REPO='rebase-network/who-is-hiring'
export GH_TOKEN='...'
export LLM_API_KEY='...'
export LLM_API_URL='https://wei-relay.hashmind.cc/openai'
export LLM_API_TYPE='openai-responses'
export LLM_MODEL='gpt-5'
export LLM_EXTRACTION_MODE='llm-first'
export LLM_BATCH_SIZE='5'
export LLM_TIMEOUT_MS='90000'
```

Notes:

- `GH_TOKEN` must have access to read issues and comments.
- `state/` is local-only and ignored by git.
- Completed LLM batches are cached in `state/llm-enrich-cache.json`.

## 3. Run local validation first

```bash
npm test
npm run typecheck
```

## 4. Run full local build

```bash
npm run build:site
```

What this does:

- fetches issues from GitHub
- filters out non-job issues
- runs parser-based normalization
- runs LLM enrichment for low-confidence issues
- reuses cached batch results from `state/llm-enrich-cache.json`
- rebuilds `data/` and `public/` outputs

If the build is interrupted, rerun the same command. The cache should prevent completed LLM batches from being recomputed.

## 5. Inspect the result

Check summary output first:

```bash
cat data/quality-summary.md
```

Recommended checks:

- `LLM-enriched issues`
- `Average completeness score`
- `Low-score open jobs`
- top missing fields
- top risk flags

Run targeted LLM spot checks if needed:

```bash
npm run spotcheck:llm -- 1050 1078 1060
```

Inspect generated diffs:

```bash
git status --short
git diff --stat
```

## 6. Commit generated outputs

If the outputs look correct:

```bash
git add data public docs
# include code changes too if this run follows implementation work
git add src scripts tests package.json .gitignore

git commit -m "Refresh hiring site with local full LLM build"
```

## 7. Push to GitHub

```bash
git push origin HEAD
```

## 8. What GitHub Actions should do

Recommended GitHub Actions responsibilities:

- run tests
- run typecheck
- deploy already-generated site artifacts
- avoid normal full LLM enrichment runs

Recommended non-goal for GitHub Actions:

- do not rely on CI to perform the full low-confidence LLM enrichment pipeline

## 9. Recovery notes

If a full local run is interrupted:

- do not delete `state/llm-enrich-cache.json`
- rerun `npm run build:site`
- verify cache reuse appears in logs

If you want a clean rerun from scratch:

```bash
rm -f state/llm-enrich-cache.json
npm run build:site
```
