# Extraction and Scoring V2 Implementation Checklist

Use this checklist to implement V2 in small, testable steps.

## 1. Extraction contract

- [ ] Update `src/extraction.ts` prompt to use explicit field contract.
- [ ] Keep extraction issue-first: title, body, author comments, metadata, then `normalized_hint`.
- [ ] Allow only author comments as formal supplemental data.
- [ ] Add explicit constraints:
  - [ ] do not treat contact handles as salary
  - [ ] do not turn `competitive` / `面议` into numeric salary fields
  - [ ] return `null` for unsupported fields
- [ ] Add V2 extracted fields:
  - [ ] `title`
  - [ ] `company`
  - [ ] `location`
  - [ ] `salary`
  - [ ] `salary_min`
  - [ ] `salary_max`
  - [ ] `salary_currency`
  - [ ] `salary_period`
  - [ ] `work_mode`
  - [ ] `employment_type`
  - [ ] `timezone`
  - [ ] `responsibilities`
  - [ ] `requirements`
  - [ ] `contact_channels`
  - [ ] `summary`
- [ ] Add extraction metadata per field:
  - [ ] `evidence`
  - [ ] `source_type`
  - [ ] `confidence`

## 2. Schema updates

- [ ] Extend `src/schemas.ts` with `requirements`.
- [ ] Add normalized metadata fields:
  - [ ] `score_breakdown`
  - [ ] `risk_flags`
  - [ ] `field_sources`
  - [ ] `comment_supplemented_fields`
  - [ ] `decision_value_score`
  - [ ] `credibility_score`
- [ ] Keep schemas strict and backward-safe where practical.

## 3. Scoring engine

- [ ] Replace equal-weight completeness scoring in `src/feedback.ts`.
- [ ] Use V2 weights:
  - [ ] title / role: 10
  - [ ] company: 14
  - [ ] location: 9
  - [ ] salary: 14
  - [ ] responsibilities: 11
  - [ ] requirements: 9
  - [ ] work_mode: 5
  - [ ] employment_type: 4
  - [ ] contact_channels: 15
  - [ ] credibility / consistency: 9
- [ ] Add partial-credit scoring for:
  - [ ] salary quality
  - [ ] responsibilities quality
  - [ ] requirements quality
  - [ ] contact quality
- [ ] Apply source weighting:
  - [ ] issue body = 100%
  - [ ] author comments only = 65%
  - [ ] non-author comments = 0%
- [ ] Add hard rules:
  - [ ] missing `contact_channels` caps total score at `59`
  - [ ] missing `contact_channels` forces `needs-info`
  - [ ] missing `company` adds major penalty and risk flag
  - [ ] missing `title` counts as high-severity missing info

## 4. Credibility and risk rules

- [ ] Add deterministic risk flags only.
- [ ] Start with these flags:
  - [ ] `company-missing`
  - [ ] `contact-missing`
  - [ ] `salary-looks-like-contact`
  - [ ] `title-body-conflict`
  - [ ] `body-comment-conflict`
  - [ ] `high-salary-low-detail`
  - [ ] `offplatform-contact-only-no-company`
- [ ] Make each flag affect score in an explainable way.
- [ ] Do not generate subjective scam labels.

## 5. Reminder flow

- [ ] Update `src/feedback.ts` reminder builder for stronger wording.
- [ ] Update `scripts/build_site.ts` to use the new thresholds.
- [ ] Apply thresholds:
  - [ ] `<55` strong reminder
  - [ ] `55-69` moderate reminder
  - [ ] `70-79` observe only
  - [ ] `>=80` no reminder
- [ ] Make reminder ask authors to edit the issue body directly.
- [ ] Mention that author comments count, but score lower than issue-body updates.
- [ ] Add a second reminder variant for comment-only supplementation.
- [ ] Stop or reduce reminders after meaningful issue-body improvement.

## 6. Output and reporting

- [ ] Expose `score_breakdown` in generated data.
- [ ] Expose `risk_flags` in generated data.
- [ ] Expose `comment_supplemented_fields` in generated data.
- [ ] Update quality summary outputs to reflect V2 scoring.

## 7. Tests

- [ ] Add test: missing `contact_channels` caps score at `59`.
- [ ] Add test: missing `company` causes strong penalty and risk flag.
- [ ] Add test: `requirements` contributes to score.
- [ ] Add test: author comments improve score at reduced weight.
- [ ] Add test: non-author comments do not improve score.
- [ ] Add test: contact info is not parsed as salary.
- [ ] Add test: issue-body update scores higher than comment-only supplementation.
- [ ] Add test: reminders stop after sufficient body improvement.
- [ ] Add test: Chinese and mixed-language cases still extract correctly.

## 8. Validation run

- [ ] Run local tests.
- [ ] Build generated outputs.
- [ ] Inspect a sample of low-score issues manually.
- [ ] Confirm reminder content is actionable and not spammy.
- [ ] Confirm existing README remains untouched.
