import { type NormalizedJob } from "./schemas.js";

export const NEEDS_INFO_LABEL = "needs-info";
const DEFAULT_LOW_SCORE_THRESHOLD = 60;
const DEFAULT_REMINDER_COOLDOWN_HOURS = 72;

type CompletenessField = "company" | "location" | "salary" | "responsibilities" | "contact_channels";

const FIELD_WEIGHTS: Array<{ key: CompletenessField; weight: number; missingField: string }> = [
  { key: "company", weight: 20, missingField: "company" },
  { key: "location", weight: 20, missingField: "location" },
  { key: "salary", weight: 20, missingField: "salary" },
  { key: "responsibilities", weight: 20, missingField: "responsibilities" },
  { key: "contact_channels", weight: 20, missingField: "contact" },
];

type ReminderState = {
  last_labeled_at: string | null;
  last_reminded_at: string | null;
  last_score: number | null;
};

export type FeedbackState = {
  issues: Record<string, ReminderState>;
};

export type CompletenessResult = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  missing_fields: string[];
};

export type FeedbackConfig = {
  lowScoreThreshold: number;
  reminderCooldownHours: number;
};

export type LowScoreDecision = {
  shouldEnsureLabel: boolean;
  shouldAddLabel: boolean;
  shouldRemoveLabel: boolean;
  shouldScheduleReminder: boolean;
  reason: string;
};

export function resolveFeedbackConfig(env: NodeJS.ProcessEnv = process.env): FeedbackConfig {
  return {
    lowScoreThreshold: toInt(env.LOW_SCORE_THRESHOLD, DEFAULT_LOW_SCORE_THRESHOLD),
    reminderCooldownHours: toInt(env.LOW_SCORE_REMINDER_COOLDOWN_HOURS, DEFAULT_REMINDER_COOLDOWN_HOURS),
  };
}

export function computeCompleteness(job: Pick<NormalizedJob, "company" | "location" | "salary" | "responsibilities" | "contact_channels">): CompletenessResult {
  let score = 0;
  const missing: string[] = [];

  for (const field of FIELD_WEIGHTS) {
    const value = job[field.key];
    const isPresent = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (isPresent) {
      score += field.weight;
    } else {
      missing.push(field.missingField);
    }
  }

  return {
    score,
    grade: scoreToGrade(score),
    missing_fields: missing,
  };
}

export function createInitialFeedbackState(): FeedbackState {
  return { issues: {} };
}

export function evaluateLowScoreLabeling(params: {
  issueNumber: number;
  isOpen: boolean;
  labels: string[];
  completeness: CompletenessResult;
  config: FeedbackConfig;
  state: FeedbackState;
  now: Date;
}): LowScoreDecision {
  const { issueNumber, isOpen, labels, completeness, config, state, now } = params;
  const key = String(issueNumber);
  const existing = state.issues[key] ?? { last_labeled_at: null, last_reminded_at: null, last_score: null };
  existing.last_score = completeness.score;
  state.issues[key] = existing;

  if (!isOpen) {
    return {
      shouldEnsureLabel: false,
      shouldAddLabel: false,
      shouldRemoveLabel: false,
      shouldScheduleReminder: false,
      reason: "issue-closed",
    };
  }

  const hasNeedsInfo = labels.includes(NEEDS_INFO_LABEL);
  const isLowScore = completeness.score < config.lowScoreThreshold;

  if (!isLowScore) {
    return {
      shouldEnsureLabel: false,
      shouldAddLabel: false,
      shouldRemoveLabel: false,
      shouldScheduleReminder: false,
      reason: "score-above-threshold",
    };
  }

  if (!hasNeedsInfo) {
    existing.last_labeled_at = now.toISOString();
    return {
      shouldEnsureLabel: true,
      shouldAddLabel: true,
      shouldRemoveLabel: false,
      shouldScheduleReminder: false,
      reason: "label-missing",
    };
  }

  const cooldownMs = config.reminderCooldownHours * 60 * 60 * 1000;
  const lastReminderAt = existing.last_reminded_at ? Date.parse(existing.last_reminded_at) : NaN;
  const canRemind = Number.isNaN(lastReminderAt) || now.getTime() - lastReminderAt >= cooldownMs;

  return {
    shouldEnsureLabel: true,
    shouldAddLabel: false,
    shouldRemoveLabel: false,
    shouldScheduleReminder: canRemind,
    reason: canRemind ? "cooldown-elapsed" : "cooldown-active",
  };
}

function toInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scoreToGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) {
    return "A";
  }
  if (score >= 80) {
    return "B";
  }
  if (score >= 70) {
    return "C";
  }
  if (score >= 60) {
    return "D";
  }
  return "F";
}
