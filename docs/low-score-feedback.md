# Low-score feedback loop (phase 1: label only)

This repository now computes a completeness score for each issue and applies a gentle low-score feedback loop.

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

## Label-only feedback behavior

On issue events, when the issue is still open and score is below threshold:

- ensure label `needs-info` exists (created once if missing)
- apply `needs-info` to the issue when not already present
- do not post comments yet (phase 1)

## Idempotency and reminder state

- Label churn is avoided: if `needs-info` already exists on the issue, no re-label API call is made.
- Reminder state is persisted in `data/feedback-state.json` under issue keys.
- State tracks `last_labeled_at`, `last_reminded_at`, and `last_score` to support future comment mode safely.

## Config knobs (for phase 2 readiness)

Environment variables:

- `LOW_SCORE_THRESHOLD` (default: `60`)
- `LOW_SCORE_REMINDER_COOLDOWN_HOURS` (default: `72`)

These are already wired into the decision logic even though comments are disabled in phase 1.
