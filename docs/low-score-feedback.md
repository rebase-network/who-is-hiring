# Low-score feedback loop

This repository computes a completeness score for each issue and applies an automated low-score feedback loop.

## Completeness fields in normalized output

Each normalized record includes:

- `completeness_score` (0-100)
- `completeness_grade` (`A|B|C|D|F`)
- `missing_fields` (array of missing hiring fields)

Current scoring weights are even across these fields:

- company
- location
- salary
- responsibilities
- contact

## Label + reminder behavior

On issue events, when the issue is open and score is below threshold:

- ensure label `needs-info` exists (created once if missing)
- apply `needs-info` when absent
- if the label is already present, post a neutral reminder comment after cooldown

Reminder comments are structured and include:

- a hidden marker (`<!-- who-is-hiring:low-score-reminder:v1 -->`) for duplicate detection
- completeness score and threshold
- bullet list of `missing_fields`
- concise instruction to update the issue body with those fields

## Idempotency and cooldown protections

The automation avoids comment spam with two safeguards:

- persisted state in `data/feedback-state.json` (`last_labeled_at`, `last_reminded_at`, `last_score`)
- marker-based scan of issue comments to detect recent bot reminders inside cooldown

A reminder is only posted when both checks allow it.

## Config knobs

Environment variables:

- `LOW_SCORE_THRESHOLD` (default: `60`)
- `LOW_SCORE_REMINDER_COOLDOWN_HOURS` (default: `72`)

These values control low-score qualification and reminder cooldown timing.
