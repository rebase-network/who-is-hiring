# Extraction and Scoring V2 Spec

This document defines the next iteration of the `who-is-hiring` extraction, scoring, and feedback loop.

The goal is to move from a simple completeness checker to a stricter, issue-first quality system that:

- extracts job facts more accurately from raw issue data
- scores posts based on both completeness and candidate decision value
- penalizes low-trust patterns more explicitly
- pushes authors to update the issue body, not just add follow-up comments

## Product goals

The system should optimize for three outcomes:

1. Candidates can quickly decide whether a role is worth considering.
2. Posts with missing or suspicious information are scored lower in a consistent, explainable way.
3. Low-quality posts trigger clear issue feedback that encourages authors to fix the issue body.

## Design principles

- Issue-first extraction: use raw GitHub issue data as the source of truth.
- Deterministic scoring: the LLM extracts facts, but local rules compute scores.
- Explainability: each score must be traceable to fields, evidence, and risk flags.
- Strong body preference: author comments can help, but updating the issue body scores higher.
- Conservative extraction: unknown stays `null`; do not infer unsupported values.

## Source priority

Field extraction uses this source priority:

1. `issue.title`
2. `issue.body`
3. comments written by the issue author
4. labels and issue metadata
5. `normalized_hint` as secondary context only

Rules:

- Only author comments may be used as formal supplemental data.
- Non-author comments do not count as official job facts.
- `normalized_hint` can help resolve low-confidence extraction, but it cannot override direct evidence from the issue.

## Required extracted fields

V2 extraction should produce these normalized fields:

- `number`
- `title`
- `company`
- `location`
- `salary`
- `salary_min`
- `salary_max`
- `salary_currency`
- `salary_period`
- `work_mode`
- `employment_type`
- `timezone`
- `responsibilities`
- `requirements`
- `contact_channels`
- `summary`

Each field should also carry extraction metadata:

- `evidence`: short snippet proving the field value
- `source_type`: one of `title | body | author_comment | derived | none`
- `confidence`: field-level confidence score or bucket

## Extraction constraints

The prompt and schema must enforce these constraints:

- Never treat contact handles, phone numbers, or messaging IDs as salary.
- `competitive`, `negotiable`, `TBD`, or `面议` may populate free-text salary, but not structured numeric salary fields without numeric evidence.
- Unknown values must be explicit `null`.
- Do not invent a company, location, or requirements from tone or context.
- If responsibilities or requirements are implied but not stated, keep them `null`.
- Keep the issue number unchanged.

## Scoring model

Total score: `100`

### Weighted fields

- `title / role`: 10
- `company`: 14
- `location`: 9
- `salary`: 14
- `responsibilities`: 11
- `requirements`: 9
- `work_mode`: 5
- `employment_type`: 4
- `contact_channels`: 15
- `credibility / consistency`: 9

### Why these weights

The highest-weight fields are the ones candidates need most to act on a posting:

- role/title
- company
- salary
- responsibilities
- requirements
- contact channels

`contact_channels` is intentionally high weight because a post without a way to apply or reach the poster is effectively unusable.

## Hard rules

### Missing contact channels

If `contact_channels` is missing:

- force `needs-info`
- cap total score at `59`

Rationale: a post without contact information is not just incomplete; it is operationally invalid for candidates.

### Missing company

If `company` is missing:

- apply a major field penalty
- add a credibility risk flag

If `company` is missing together with weak contact information, missing salary, or other major gaps, the post should be treated as high-risk and pushed into the reminder flow aggressively.

### Missing title / role

If `title` is missing or too weak to indicate the role clearly:

- apply a major field penalty
- treat as high-severity missing info

## Partial-credit rules

Field scoring should not be binary. Use presence plus quality.

### Salary

Suggested tiers:

- `0`: no salary information
- low partial: `competitive`, `negotiable`, or vague salary only
- medium: numeric salary but missing currency or period
- high: range plus currency and period

### Responsibilities

Suggested tiers:

- `0`: missing
- low partial: one vague sentence
- medium: 2-3 concrete duties
- high: 3-5 clear and specific duties

### Requirements

Suggested tiers:

- `0`: missing
- low partial: generic statements only
- medium: some explicit experience or skill requirements
- high: clear qualification or skill expectations candidates can self-evaluate against

### Contact channels

Suggested tiers:

- high: official application link, official email, ATS, or clear application form
- medium-high: clear Telegram / Discord / WeChat / direct contact route
- low partial: `DM me` with no explicit channel details
- `0`: no contact path

## Comment vs issue body scoring

Body updates should be preferred over comment-only supplementation.

Scoring rule:

- issue body evidence: `100%` of field score
- author comment evidence only: `65%` of field score
- non-author comment evidence: `0%`

This means:

- author comments can improve the score
- but they cannot achieve the same score as updating the issue body directly

Additional derived fields:

- `comment_supplemented_fields`: array of field names populated only from author comments
- `field_sources`: map of field name to source type

## Credibility and consistency scoring

This bucket must remain deterministic and rule-based.

Examples of risk flags:

- `company-missing`
- `contact-missing`
- `salary-looks-like-contact`
- `title-body-conflict`
- `body-comment-conflict`
- `high-salary-low-detail`
- `offplatform-contact-only-no-company`

Rules in this bucket should reduce score based on explicit, explainable signals. Avoid subjective LLM-generated trust judgments.

## Feedback behavior

The automated issue feedback loop should remain event-driven.

### Thresholds

Suggested thresholds:

- `<55`: strong reminder, add or keep `needs-info`
- `55-69`: moderate reminder, keep `needs-info`
- `70-79`: observe, no aggressive reminder
- `>=80`: no reminder

### Reminder content requirements

Reminder comments should:

- state that key candidate-facing information is missing or weak
- list the specific missing or weak fields
- explicitly ask the author to edit the issue body
- explain that author comments can count, but issue body updates score higher

### Special handling for comment-only updates

If the author added the missing details in comments but not in the issue body:

- acknowledge that the additional information was seen
- ask the author to copy it back into the issue body
- avoid repeating the full original reminder if not necessary

## Proposed reminder copy

```text
<!-- who-is-hiring:low-score-reminder:v2 -->
Thanks for sharing this role.

This posting is currently missing key information candidates need to evaluate the role.
Please edit the issue body and add or improve the fields below:

- role/title
- company
- salary range / currency / period
- core responsibilities
- requirements
- work location / remote policy
- contact method

Notes:
- Author comments can be counted, but updating the issue body is scored higher and is strongly preferred.
- Clear issue content helps candidates assess fit, trust the post, and apply efficiently.
```

A second reminder variant should be used when the author already added details in comments:

```text
<!-- who-is-hiring:low-score-reminder:v2 -->
We saw additional job details in the author comments.
Please sync those details back into the issue body so the post can receive the full score and be easier for candidates to evaluate.
```

## Schema changes

`src/schemas.ts` should be extended with fields like:

- `requirements: string | null`
- `score_breakdown`
- `risk_flags: string[]`
- `field_sources`
- `comment_supplemented_fields: string[]`
- `decision_value_score`
- `credibility_score`

The exact shape can be refined during implementation, but these concepts should exist in normalized output and be available to downstream reporting.

## Implementation plan

### Phase 1: extraction contract

Files:

- `src/extraction.ts`
- `src/schemas.ts`

Tasks:

- strengthen the LLM prompt with the explicit V2 field contract
- extend schema to support `requirements`, evidence, and source metadata
- ensure author-comment-only sourcing is enforced

### Phase 2: scoring engine

Files:

- `src/feedback.ts`

Tasks:

- replace even-weight completeness scoring with weighted V2 scoring
- add partial-credit logic
- add score cap and hard-rule handling
- add credibility/risk bucket

### Phase 3: reminder flow

Files:

- `src/feedback.ts`
- `scripts/build_site.ts`

Tasks:

- update threshold logic
- use new reminder body variants
- distinguish comment-only supplementation from issue-body updates
- stop or reduce reminders after meaningful improvements

### Phase 4: reporting and UI surfaces

Files:

- `data/quality-summary.json`
- `data/quality-summary.md`
- site rendering paths that expose quality metadata

Tasks:

- expose `score_breakdown`
- expose top missing fields and risk flags
- expose summary metrics for low-score and comment-supplemented issues

## Required tests

At minimum, add or update tests for:

- missing `contact_channels` caps score at `59`
- missing `company` causes a strong penalty and risk flag
- `requirements` contributes to score
- author comments improve score at reduced weight
- non-author comments do not improve score
- salary parsing does not confuse contact information for compensation
- updating the issue body improves score more than comment-only supplementation
- posts move out of reminder flow after sufficient issue-body improvement
- Chinese and mixed-language issues still extract correctly

## Non-goals

V2 should not:

- use the LLM to assign the final score directly
- classify posts as scams in a subjective or unreviewable way
- rely on scheduled polling instead of issue events
- modify the original repository `README.md`
