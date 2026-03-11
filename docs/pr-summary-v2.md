# PR Summary: Hiring Quality V2 + Local Full Build Workflow

## What changed

This change set upgrades the hiring pipeline from a simple completeness checker into a fuller quality system that combines:

- stronger parser-based extraction
- weighted quality scoring
- clearer low-score reminders
- richer site quality visibility
- live LLM enrichment for low-confidence issues
- resumable local full-build workflow

## Main product changes

### 1. Extraction quality improved

The parser and LLM enrichment pipeline now extract more candidate-facing job information, especially for mixed Chinese/English posts.

Improved fields include:

- company
- location
- salary
- work mode
- employment type
- responsibilities
- requirements
- contact channels

Examples of improved coverage:

- title-based salary like `25K+` or `5000-8000 USD`
- Chinese company patterns like `游戏集团 招 SEO主管`
- work mode phrases like `现场办公`, `远端`, `半远端`, `居家办公`
- employment hints like `工作性质`, `是否全职：是`, `工时`, `月休`
- responsibility and requirement headings like `你负责`, `你需要搞定`, `核心挑战`, `我们需要的你`, `加分项`

### 2. Scoring upgraded to V2

Scoring is now weighted and more candidate-oriented.

Core fields include:

- title / role
- company
- location
- salary
- responsibilities
- requirements
- work mode
- employment type
- contact channels
- credibility / consistency

Important rules:

- missing contact channels caps total score at `59`
- missing company is strongly penalized and flagged
- author-comment-only data counts at reduced value
- deterministic risk flags affect credibility score

### 3. Reminder flow improved

Low-score issue feedback now supports:

- stronger score-based reminder bands
- clearer issue-body update guidance
- comment-sync reminders when the author only added details in comments
- automatic `needs-info` removal after score recovery
- legacy reminder marker compatibility

### 4. Site and summary output improved

The public site and generated summaries now expose more quality metadata:

- decision value score
- credibility score
- missing fields
- weak fields
- risk flags
- score breakdown
- comment-supplemented fields

### 5. Non-job issue filtering added

Obvious non-job issues are filtered out before entering the hiring pipeline, so quality summaries are less polluted.

### 6. LLM enrichment is now practical for local full builds

The LLM enrich path was hardened with:

- richer prompt guidance and examples
- better source-priority rules
- better relay output normalization
- stronger merge behavior for missing and weak fields
- batch progress logging
- resumable cache in `state/llm-enrich-cache.json`

## Operational change

The recommended workflow is now local-first for full builds.

Reason:

- full low-confidence LLM enrichment is too slow and fragile for normal GitHub Actions runs
- long CI jobs are more likely to hit time limits or be canceled
- local runs can resume via cache

Recommended workflow:

1. pull latest code locally
2. set GitHub + LLM env vars
3. run tests and typecheck
4. run full `build:site`
5. inspect generated outputs
6. commit `data/` and `public/` artifacts
7. push to GitHub

Runbook:

- `docs/local-full-build-runbook.md`

## Outcome from latest successful local full build

Latest successful local full build produced:

- open jobs: `770`
- average completeness score: `76.41`
- average decision value score: `57.31`
- average credibility score: `7.05`
- low-score open jobs: `72`
- low-confidence issues: `293`
- LLM-enriched issues: `274`

Compared with the earlier baseline:

- average completeness score improved from `70.08` to `76.41`
- low-score open jobs dropped from `192` to `72`

## Key commits in this series

- `6e87f169` Implement hiring quality scoring v2 core logic
- `f414be54` Expose v2 hiring quality metadata in site output
- `fefa1a15` Refine low-score reminder bands and label recovery
- `e2bac9a0` Filter non-job issues from hiring site build
- `1ed28bd0` Improve title-based salary and company extraction
- `992a3f04` Reduce noisy requirement extraction in hiring parser
- `27839414` Tune scoring thresholds for concise hiring details
- `9b8a3075` Capture more work mode signals in hiring parser
- `48650a29` Improve employment type extraction from job posts
- `d1c3cbc5` Prioritize missing-field recovery in LLM enrichment
- `ac183429` Tighten LLM extraction examples and constraints
- `e57af97d` Normalize richer relay outputs for LLM enrichment
- `d8dd45d2` Add resumable cache for LLM enrichment
- `19f517b1` Refresh site data after full local LLM build

## Notes for review

Reviewers should focus on:

- whether low-score posts are now more reasonably classified
- whether extracted candidate-facing fields look more complete and more accurate
- whether the local-first full-build workflow is acceptable for the repo
- whether GitHub Actions should remain limited to validation/deployment rather than full enrichment
