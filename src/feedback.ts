import { type NormalizedJob } from "./schemas.js";

export const NEEDS_INFO_LABEL = "needs-info";
export const LOW_SCORE_REMINDER_MARKER = "<!-- who-is-hiring:low-score-reminder:v2 -->";
const LEGACY_LOW_SCORE_REMINDER_MARKER = "<!-- who-is-hiring:low-score-reminder:v1 -->";
const DEFAULT_LOW_SCORE_THRESHOLD = 60;
const DEFAULT_REMINDER_COOLDOWN_HOURS = 72;
const STRONG_REMINDER_THRESHOLD = 55;
const MODERATE_REMINDER_THRESHOLD = 70;
const LABEL_REMOVAL_THRESHOLD = 80;
const AUTHOR_COMMENT_WEIGHT = 0.65;

type ScoredField =
  | "title"
  | "company"
  | "location"
  | "salary"
  | "responsibilities"
  | "requirements"
  | "work_mode"
  | "employment_type"
  | "contact_channels"
  | "credibility";

type ReminderState = {
  last_labeled_at: string | null;
  last_reminded_at: string | null;
  last_score: number | null;
};

export type FeedbackState = {
  issues: Record<string, ReminderState>;
};

export type ScoreBreakdown = Record<
  ScoredField,
  {
    earned: number;
    max: number;
    source: string | null;
  }
>;

export type CompletenessResult = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  missing_fields: string[];
  weak_fields: string[];
  risk_flags: string[];
  score_breakdown: ScoreBreakdown;
  decision_value_score: number;
  credibility_score: number;
};

export type FeedbackConfig = {
  lowScoreThreshold: number;
  reminderCooldownHours: number;
};

export type ReminderBand = "strong" | "moderate" | "comment-sync" | null;

export type LowScoreDecision = {
  shouldEnsureLabel: boolean;
  shouldAddLabel: boolean;
  shouldRemoveLabel: boolean;
  shouldScheduleReminder: boolean;
  reminderBand: ReminderBand;
  reason: string;
};

const FIELD_WEIGHTS: Record<ScoredField, number> = {
  title: 10,
  company: 14,
  location: 9,
  salary: 14,
  responsibilities: 11,
  requirements: 9,
  work_mode: 5,
  employment_type: 4,
  contact_channels: 15,
  credibility: 9,
};

export function resolveFeedbackConfig(env: NodeJS.ProcessEnv = process.env): FeedbackConfig {
  return {
    lowScoreThreshold: toInt(env.LOW_SCORE_THRESHOLD, DEFAULT_LOW_SCORE_THRESHOLD),
    reminderCooldownHours: toInt(env.LOW_SCORE_REMINDER_COOLDOWN_HOURS, DEFAULT_REMINDER_COOLDOWN_HOURS),
  };
}

export function computeCompleteness(
  job: Pick<
    NormalizedJob,
    | "title"
    | "company"
    | "location"
    | "salary"
    | "salary_currency"
    | "salary_period"
    | "work_mode"
    | "employment_type"
    | "responsibilities"
    | "requirements"
    | "contact_channels"
    | "field_sources"
    | "risk_flags"
  >,
): CompletenessResult {
  const missing = new Set<string>();
  const weak = new Set<string>();
  const riskFlags = Array.from(new Set([...(job.risk_flags ?? []), ...deriveRiskFlags(job)]));

  const breakdown: ScoreBreakdown = {
    title: scoreField("title", scoreTitle(job.title), sourceOf(job, "title")),
    company: scoreField("company", scoreCompany(job.company), sourceOf(job, "company")),
    location: scoreField("location", scoreLocation(job.location), sourceOf(job, "location")),
    salary: scoreField("salary", scoreSalary(job), sourceOf(job, "salary")),
    responsibilities: scoreField("responsibilities", scoreLongText(job.responsibilities, FIELD_WEIGHTS.responsibilities), sourceOf(job, "responsibilities")),
    requirements: scoreField("requirements", scoreLongText(job.requirements, FIELD_WEIGHTS.requirements), sourceOf(job, "requirements")),
    work_mode: scoreField("work_mode", scoreSimpleText(job.work_mode, FIELD_WEIGHTS.work_mode), sourceOf(job, "work_mode")),
    employment_type: scoreField("employment_type", scoreSimpleText(job.employment_type, FIELD_WEIGHTS.employment_type), sourceOf(job, "employment_type")),
    contact_channels: scoreField("contact_channels", scoreContactChannels(job.contact_channels ?? []), sourceOf(job, "contact_channels")),
    credibility: scoreField("credibility", scoreCredibility(riskFlags), null),
  };

  markFieldHealth("title", breakdown.title, missing, weak);
  markFieldHealth("company", breakdown.company, missing, weak);
  markFieldHealth("location", breakdown.location, missing, weak);
  markFieldHealth("salary", breakdown.salary, missing, weak);
  markFieldHealth("responsibilities", breakdown.responsibilities, missing, weak);
  markFieldHealth("requirements", breakdown.requirements, missing, weak);
  markFieldHealth("work_mode", breakdown.work_mode, missing, weak);
  markFieldHealth("employment_type", breakdown.employment_type, missing, weak);
  markFieldHealth("contact", breakdown.contact_channels, missing, weak);

  const totalBeforeCap = Object.values(breakdown).reduce((sum, field) => sum + field.earned, 0);
  const hardCap = riskFlags.includes("contact-missing") ? 59 : null;
  const score = Math.max(0, Math.round(hardCap == null ? totalBeforeCap : Math.min(totalBeforeCap, hardCap)));
  const decisionValueScore = Math.round(
    breakdown.title.earned +
      breakdown.location.earned +
      breakdown.salary.earned +
      breakdown.responsibilities.earned +
      breakdown.requirements.earned +
      breakdown.work_mode.earned +
      breakdown.employment_type.earned +
      breakdown.contact_channels.earned,
  );
  const credibilityScore = Math.round(breakdown.credibility.earned);

  return {
    score,
    grade: scoreToGrade(score),
    missing_fields: Array.from(missing),
    weak_fields: Array.from(weak).filter((field) => !missing.has(field)),
    risk_flags: riskFlags,
    score_breakdown: breakdown,
    decision_value_score: decisionValueScore,
    credibility_score: credibilityScore,
  };
}

export function createInitialFeedbackState(): FeedbackState {
  return { issues: {} };
}

export function evaluateLowScoreLabeling(params: {
  issueNumber: number;
  isOpen: boolean;
  labels: string[];
  completeness: Pick<CompletenessResult, "score" | "grade" | "missing_fields" | "risk_flags">;
  config: FeedbackConfig;
  state: FeedbackState;
  now: Date;
  hasRecentReminderComment: boolean;
  hasCommentSupplementedFields?: boolean;
}): LowScoreDecision {
  const { issueNumber, isOpen, labels, completeness, config, state, now, hasRecentReminderComment, hasCommentSupplementedFields = false } = params;
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
      reminderBand: null,
      reason: "issue-closed",
    };
  }

  const hasNeedsInfo = labels.includes(NEEDS_INFO_LABEL);
  const forceNeedsInfo = completeness.risk_flags.includes("contact-missing");
  const score = completeness.score;
  const isStrongBand = score < STRONG_REMINDER_THRESHOLD || forceNeedsInfo;
  const isModerateBand = !isStrongBand && score < MODERATE_REMINDER_THRESHOLD;
  const isObserveBand = !isStrongBand && !isModerateBand && score < LABEL_REMOVAL_THRESHOLD;

  if (score >= LABEL_REMOVAL_THRESHOLD && !forceNeedsInfo) {
    return {
      shouldEnsureLabel: false,
      shouldAddLabel: false,
      shouldRemoveLabel: hasNeedsInfo,
      shouldScheduleReminder: false,
      reminderBand: null,
      reason: hasNeedsInfo ? "score-recovered-remove-label" : "score-above-threshold",
    };
  }

  if (isObserveBand) {
    return {
      shouldEnsureLabel: hasNeedsInfo,
      shouldAddLabel: false,
      shouldRemoveLabel: false,
      shouldScheduleReminder: false,
      reminderBand: null,
      reason: "observe-band",
    };
  }

  if (!isStrongBand && !isModerateBand) {
    return {
      shouldEnsureLabel: false,
      shouldAddLabel: false,
      shouldRemoveLabel: false,
      shouldScheduleReminder: false,
      reminderBand: null,
      reason: "score-above-threshold",
    };
  }

  const reminderBand: ReminderBand = hasCommentSupplementedFields ? "comment-sync" : isStrongBand ? "strong" : "moderate";

  if (!hasNeedsInfo) {
    existing.last_labeled_at = now.toISOString();
    return {
      shouldEnsureLabel: true,
      shouldAddLabel: true,
      shouldRemoveLabel: false,
      shouldScheduleReminder: false,
      reminderBand,
      reason: forceNeedsInfo ? "contact-missing-hard-rule" : isStrongBand ? "strong-band-label-missing" : "moderate-band-label-missing",
    };
  }

  const cooldownMs = config.reminderCooldownHours * 60 * 60 * 1000;
  const lastReminderAt = existing.last_reminded_at ? Date.parse(existing.last_reminded_at) : Number.NaN;
  const canRemindByState = Number.isNaN(lastReminderAt) || now.getTime() - lastReminderAt >= cooldownMs;
  const canRemind = canRemindByState && !hasRecentReminderComment;
  const reason = !canRemindByState ? "cooldown-active" : hasRecentReminderComment ? "recent-bot-reminder" : reminderBand === "strong" ? "strong-band-reminder" : reminderBand === "moderate" ? "moderate-band-reminder" : "comment-sync-reminder";

  return {
    shouldEnsureLabel: true,
    shouldAddLabel: false,
    shouldRemoveLabel: false,
    shouldScheduleReminder: canRemind,
    reminderBand,
    reason,
  };
}

export function hasRecentLowScoreReminderComment(params: {
  comments: Array<{ body: string | null; created_at: string; user_type?: string | null }>;
  now: Date;
  cooldownHours: number;
}): boolean {
  const { comments, now, cooldownHours } = params;
  const cooldownMs = cooldownHours * 60 * 60 * 1000;

  for (const comment of comments) {
    if (!comment.body?.includes(LOW_SCORE_REMINDER_MARKER) && !comment.body?.includes(LEGACY_LOW_SCORE_REMINDER_MARKER)) {
      continue;
    }
    if (comment.user_type && comment.user_type !== "Bot") {
      continue;
    }

    const createdAt = Date.parse(comment.created_at);
    if (!Number.isNaN(createdAt) && now.getTime() - createdAt < cooldownMs) {
      return true;
    }
  }

  return false;
}

export function buildLowScoreReminderComment(params: {
  score: number;
  threshold: number;
  missingFields: string[];
  weakFields?: string[];
  commentSupplementedFields?: string[];
  reminderBand?: ReminderBand;
}): string {
  const { score, threshold, missingFields, weakFields = [], commentSupplementedFields = [], reminderBand = "moderate" } = params;
  const missing = missingFields.length ? missingFields.map((field) => `- ${field}`).join("\n") : "- none";
  const weak = weakFields.length ? weakFields.map((field) => `- ${field}`).join("\n") : null;
  const commentOnly = commentSupplementedFields.length
    ? commentSupplementedFields.map((field) => `- ${field}`).join("\n")
    : null;

  if (reminderBand === "comment-sync") {
    return [
      LOW_SCORE_REMINDER_MARKER,
      "We saw additional job details in the author comments.",
      "",
      "Please sync those details back into the issue body so the post can receive the full score and be easier for candidates to evaluate.",
      `- Current score: ${score}/${threshold}`,
      commentOnly ? "\nAuthor-comment-only fields seen:\n" + commentOnly : null,
      "",
      "Notes:",
      "- Author comments can be counted, but updating the issue body is scored higher and is strongly preferred.",
    ]
      .filter((line) => line != null)
      .join("\n");
  }

  const intro = reminderBand === "strong"
    ? "This posting is currently missing key information candidates need in order to evaluate or act on the role."
    : "This posting is currently missing key information candidates need to evaluate the role.";

  return [
    LOW_SCORE_REMINDER_MARKER,
    "Thanks for sharing this role.",
    "",
    intro,
    `- Current score: ${score}/${threshold}`,
    "",
    "Please edit the issue body and add or improve the fields below:",
    missing,
    weak ? "\nWeak fields:\n" + weak : null,
    commentOnly ? "\nAuthor-comment-only fields seen:\n" + commentOnly : null,
    "",
    "Notes:",
    "- Author comments can be counted, but updating the issue body is scored higher and is strongly preferred.",
    "- Clear issue content helps candidates assess fit, trust the post, and apply efficiently.",
  ]
    .filter((line) => line != null)
    .join("\n");
}

function scoreField(field: ScoredField, rawScore: number, source: string | null): ScoreBreakdown[ScoredField] {
  const sourceWeight = source === "author_comment" ? AUTHOR_COMMENT_WEIGHT : 1;
  return {
    earned: clamp(Number((rawScore * sourceWeight).toFixed(2)), 0, FIELD_WEIGHTS[field]),
    max: FIELD_WEIGHTS[field],
    source,
  };
}

function scoreTitle(title: string): number {
  const compact = title.replace(TITLE_PREFIX_RE, "").trim();
  if (!compact || compact.length < 4) {
    return 0;
  }
  if (/^(hiring|job|jobs|recruiting|招聘|诚聘|招募)$/i.test(compact)) {
    return 0;
  }
  return FIELD_WEIGHTS.title;
}

function scoreCompany(company: string | null | undefined): number {
  return clean(company) ? FIELD_WEIGHTS.company : 0;
}

function scoreLocation(location: string | null | undefined): number {
  return clean(location) ? FIELD_WEIGHTS.location : 0;
}

function scoreSalary(job: Pick<NormalizedJob, "salary" | "salary_currency" | "salary_period">): number {
  const salary = clean(job.salary);
  if (!salary) {
    return 0;
  }
  if (/(competitive|negotiable|面议|open to discuss|tbd)/i.test(salary)) {
    return 4;
  }
  const hasNumbers = /\d/.test(salary);
  const hasCurrency = Boolean(clean(job.salary_currency)) || /(?:USD|USDT|CNY|RMB|HKD|SGD|EUR|GBP|TWD|[$¥￥]|港币|台币|元)/i.test(salary);
  const hasPeriod = Boolean(clean(job.salary_period)) || /(?:month|monthly|year|annual|week|day|hour|月|年|天|小时)/i.test(salary);
  const hasRange = /\d\s*[-~至]\s*\d/.test(salary) || /\d+k\s*[-~]\s*\d+k/i.test(salary);

  if (hasNumbers && hasCurrency && hasPeriod && hasRange) {
    return FIELD_WEIGHTS.salary;
  }
  if (hasNumbers && hasCurrency && hasPeriod) {
    return 12;
  }
  if (hasNumbers && hasCurrency) {
    return 10;
  }
  if (hasNumbers) {
    return 8;
  }
  return 4;
}

function scoreLongText(value: string | null | undefined, max: number): number {
  const compact = clean(value);
  if (!compact) {
    return 0;
  }

  const bulletCount = compact
    .split(/\n|[;；•·]/)
    .map((item) => item.trim())
    .filter(Boolean).length;
  const wordCount = compact.split(/\s+/).filter(Boolean).length;
  const charCount = compact.length;

  if (bulletCount >= 3 || wordCount >= 18 || charCount >= 90) {
    return max;
  }
  if (bulletCount >= 2 || wordCount >= 10 || charCount >= 50) {
    return Math.round(max * 0.7);
  }
  return Math.round(max * 0.35);
}

function scoreSimpleText(value: string | null | undefined, max: number): number {
  return clean(value) ? max : 0;
}

function scoreContactChannels(channels: string[]): number {
  const values = (channels ?? []).map((value) => clean(value)).filter((value): value is string => Boolean(value));
  if (values.length === 0) {
    return 0;
  }
  if (values.some((value) => /(?:https?:\/\/|apply|career|careers|jobs@|recruit|mailto:|email:)/i.test(value))) {
    return FIELD_WEIGHTS.contact_channels;
  }
  if (values.some((value) => /(?:telegram|discord|wechat|tg:|tg@|@\w+)/i.test(value))) {
    return 11;
  }
  if (values.some((value) => /\bdm\b|direct message|私聊|评论联系/i.test(value))) {
    return 5;
  }
  return 8;
}

function scoreCredibility(riskFlags: string[]): number {
  let score = FIELD_WEIGHTS.credibility;
  const penaltyByFlag: Record<string, number> = {
    "company-missing": 4,
    "contact-missing": 4,
    "salary-looks-like-contact": 4,
    "title-missing": 3,
    "title-body-conflict": 2,
    "body-comment-conflict": 2,
    "high-salary-low-detail": 2,
    "offplatform-contact-only-no-company": 3,
  };

  for (const flag of riskFlags) {
    score -= penaltyByFlag[flag] ?? 0;
  }

  return Math.max(0, score);
}

function deriveRiskFlags(
  job: Pick<
    NormalizedJob,
    | "title"
    | "company"
    | "salary"
    | "responsibilities"
    | "requirements"
    | "contact_channels"
  >,
): string[] {
  const flags: string[] = [];
  const contacts = (job.contact_channels ?? []).map((value) => clean(value)).filter((value): value is string => Boolean(value));

  if (!clean(job.company)) {
    flags.push("company-missing");
  }
  if (contacts.length === 0) {
    flags.push("contact-missing");
  }
  if (clean(job.salary) && !clean(job.responsibilities) && !clean(job.requirements)) {
    flags.push("high-salary-low-detail");
  }
  if (!clean(job.company) && contacts.length > 0 && contacts.every((value) => !/(?:https?:\/\/|@.*\.|email:|mailto:)/i.test(value))) {
    flags.push("offplatform-contact-only-no-company");
  }
  if (looksLikeContactInSalary(job.salary)) {
    flags.push("salary-looks-like-contact");
  }
  if (!clean(job.title) || /^(hiring|job|jobs|招聘|诚聘|招募)$/i.test(job.title.replace(TITLE_PREFIX_RE, "").trim())) {
    flags.push("title-missing");
  }

  return flags;
}

function sourceOf(job: Pick<NormalizedJob, "field_sources">, field: string): string | null {
  return job.field_sources?.[field] ?? null;
}

function markFieldHealth(field: string, score: { earned: number; max: number }, missing: Set<string>, weak: Set<string>): void {
  if (score.earned <= 0) {
    missing.add(field);
    return;
  }
  if (score.earned < score.max) {
    weak.add(field);
  }
}

function looksLikeContactInSalary(value: string | null | undefined): boolean {
  const compact = clean(value);
  if (!compact) {
    return false;
  }
  if (/(?:telegram|wechat|whatsapp|contact|phone|手机号|联系方式)/i.test(compact)) {
    return true;
  }
  const digits = compact.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 && !/(?:USD|CNY|HKD|SGD|EUR|GBP|[$¥￥]|month|year|月|年|k)/i.test(compact);
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

function clean(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact || null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const TITLE_PREFIX_RE = /^(?:\[[^\]]+\]\s*)+/;
