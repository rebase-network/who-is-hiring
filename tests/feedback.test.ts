import {
  buildLowScoreReminderComment,
  computeCompleteness,
  createInitialFeedbackState,
  evaluateLowScoreLabeling,
  hasRecentLowScoreReminderComment,
  LOW_SCORE_REMINDER_MARKER,
  resolveFeedbackConfig,
} from "../src/feedback.js";

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    title: "[Remote] Acme hiring Backend Engineer",
    company: "Acme",
    location: "Remote",
    salary: "5000-7000 USD / month",
    salary_currency: "USD",
    salary_period: "month",
    work_mode: "Remote",
    employment_type: "Full-time",
    responsibilities: "Build backend services; maintain APIs; improve reliability.",
    requirements: "3+ years TypeScript; backend systems; SQL.",
    contact_channels: ["email:jobs@acme.dev"],
    field_sources: {
      title: "title",
      company: "body",
      location: "body",
      salary: "body",
      work_mode: "body",
      employment_type: "body",
      responsibilities: "body",
      requirements: "body",
      contact_channels: "body",
    } as const,
    risk_flags: [] as string[],
    ...overrides,
  };
}

describe("computeCompleteness", () => {
  it("scores complete issues at 100", () => {
    const result = computeCompleteness(makeJob());

    expect(result.score).toBe(100);
    expect(result.grade).toBe("A");
    expect(result.missing_fields).toEqual([]);
    expect(result.risk_flags).toEqual([]);
  });

  it("caps score at 59 and flags missing contact channels", () => {
    const result = computeCompleteness(
      makeJob({
        contact_channels: [],
        field_sources: { ...makeJob().field_sources, contact_channels: "none" },
      }),
    );

    expect(result.score).toBeLessThanOrEqual(59);
    expect(result.risk_flags).toContain("contact-missing");
    expect(result.missing_fields).toContain("contact");
  });

  it("gives reduced credit to author-comment-only fields", () => {
    const result = computeCompleteness(
      makeJob({
        responsibilities: "Build backend services; maintain APIs; improve reliability.",
        field_sources: { ...makeJob().field_sources, responsibilities: "author_comment" },
      }),
    );

    expect(result.score_breakdown.responsibilities.earned).toBeLessThan(result.score_breakdown.responsibilities.max);
    expect(result.score_breakdown.responsibilities.source).toBe("author_comment");
  });

  it("treats requirements as a scored missing field", () => {
    const result = computeCompleteness(
      makeJob({
        requirements: null,
        field_sources: { ...makeJob().field_sources, requirements: "none" },
      }),
    );

    expect(result.missing_fields).toContain("requirements");
    expect(result.score).toBeLessThan(100);
  });
});

describe("evaluateLowScoreLabeling", () => {
  it("adds needs-info on low-score open issues that do not have the label", () => {
    const state = createInitialFeedbackState();
    const decision = evaluateLowScoreLabeling({
      issueNumber: 42,
      isOpen: true,
      labels: ["jobs"],
      completeness: { score: 40, grade: "F", missing_fields: ["salary"], risk_flags: [] },
      config: { lowScoreThreshold: 60, reminderCooldownHours: 72 },
      state,
      now: new Date("2026-03-05T12:00:00Z"),
      hasRecentReminderComment: false,
    });

    expect(decision.shouldEnsureLabel).toBe(true);
    expect(decision.shouldAddLabel).toBe(true);
    expect(decision.reminderBand).toBe("strong");
    expect(state.issues["42"]?.last_labeled_at).toBe("2026-03-05T12:00:00.000Z");
  });

  it("forces needs-info when contact is missing even at threshold edge", () => {
    const state = createInitialFeedbackState();
    const decision = evaluateLowScoreLabeling({
      issueNumber: 77,
      isOpen: true,
      labels: ["jobs"],
      completeness: { score: 59, grade: "F", missing_fields: ["contact"], risk_flags: ["contact-missing"] },
      config: { lowScoreThreshold: 55, reminderCooldownHours: 72 },
      state,
      now: new Date("2026-03-05T12:00:00Z"),
      hasRecentReminderComment: false,
    });

    expect(decision.shouldAddLabel).toBe(true);
    expect(decision.reason).toBe("contact-missing-hard-rule");
  });

  it("uses moderate band between 55 and 69", () => {
    const decision = evaluateLowScoreLabeling({
      issueNumber: 90,
      isOpen: true,
      labels: ["needs-info"],
      completeness: { score: 63, grade: "D", missing_fields: ["salary"], risk_flags: [] },
      config: { lowScoreThreshold: 60, reminderCooldownHours: 72 },
      state: createInitialFeedbackState(),
      now: new Date("2026-03-05T12:00:00Z"),
      hasRecentReminderComment: false,
    });

    expect(decision.reminderBand).toBe("moderate");
    expect(decision.shouldScheduleReminder).toBe(true);
  });

  it("uses observe band between 70 and 79 without reminders", () => {
    const decision = evaluateLowScoreLabeling({
      issueNumber: 91,
      isOpen: true,
      labels: ["needs-info"],
      completeness: { score: 75, grade: "C", missing_fields: [], risk_flags: [] },
      config: { lowScoreThreshold: 60, reminderCooldownHours: 72 },
      state: createInitialFeedbackState(),
      now: new Date("2026-03-05T12:00:00Z"),
      hasRecentReminderComment: false,
    });

    expect(decision.reason).toBe("observe-band");
    expect(decision.shouldScheduleReminder).toBe(false);
    expect(decision.reminderBand).toBe(null);
  });

  it("removes needs-info after recovery past 80", () => {
    const decision = evaluateLowScoreLabeling({
      issueNumber: 92,
      isOpen: true,
      labels: ["jobs", "needs-info"],
      completeness: { score: 82, grade: "B", missing_fields: [], risk_flags: [] },
      config: { lowScoreThreshold: 60, reminderCooldownHours: 72 },
      state: createInitialFeedbackState(),
      now: new Date("2026-03-05T12:00:00Z"),
      hasRecentReminderComment: false,
    });

    expect(decision.shouldRemoveLabel).toBe(true);
    expect(decision.reason).toBe("score-recovered-remove-label");
  });

  it("switches to comment-sync reminder when only comments added info", () => {
    const decision = evaluateLowScoreLabeling({
      issueNumber: 93,
      isOpen: true,
      labels: ["needs-info"],
      completeness: { score: 62, grade: "D", missing_fields: ["salary"], risk_flags: [] },
      config: { lowScoreThreshold: 60, reminderCooldownHours: 72 },
      state: createInitialFeedbackState(),
      now: new Date("2026-03-05T12:00:00Z"),
      hasRecentReminderComment: false,
      hasCommentSupplementedFields: true,
    });

    expect(decision.reminderBand).toBe("comment-sync");
  });
});

describe("hasRecentLowScoreReminderComment", () => {
  it("detects marker comments from bots within cooldown", () => {
    const now = new Date("2026-03-05T12:00:00Z");
    const comments = [
      {
        body: `${LOW_SCORE_REMINDER_MARKER}\nPlease update fields`,
        created_at: "2026-03-05T11:00:00Z",
        user_type: "Bot",
      },
    ];

    expect(hasRecentLowScoreReminderComment({ comments, now, cooldownHours: 72 })).toBe(true);
  });

  it("accepts legacy v1 markers for duplicate suppression", () => {
    const now = new Date("2026-03-05T12:00:00Z");
    const comments = [
      {
        body: "<!-- who-is-hiring:low-score-reminder:v1 -->\nLegacy note",
        created_at: "2026-03-05T11:00:00Z",
        user_type: "Bot",
      },
    ];

    expect(hasRecentLowScoreReminderComment({ comments, now, cooldownHours: 72 })).toBe(true);
  });
});

describe("buildLowScoreReminderComment", () => {
  it("includes marker and body-update guidance", () => {
    const body = buildLowScoreReminderComment({
      score: 40,
      threshold: 60,
      missingFields: ["salary", "contact"],
      weakFields: ["requirements"],
      commentSupplementedFields: ["responsibilities"],
      reminderBand: "strong",
    });

    expect(body).toContain(LOW_SCORE_REMINDER_MARKER);
    expect(body).toContain("Current score: 40/60");
    expect(body).toContain("Please edit the issue body");
    expect(body).toContain("Author-comment-only fields seen");
  });

  it("uses sync-back wording for comment-only supplementation", () => {
    const body = buildLowScoreReminderComment({
      score: 62,
      threshold: 60,
      missingFields: ["salary"],
      commentSupplementedFields: ["responsibilities"],
      reminderBand: "comment-sync",
    });

    expect(body).toContain("We saw additional job details in the author comments");
    expect(body).toContain("sync those details back into the issue body");
  });
});

describe("resolveFeedbackConfig", () => {
  it("uses defaults when env vars are missing", () => {
    const config = resolveFeedbackConfig({});
    expect(config.lowScoreThreshold).toBe(60);
    expect(config.reminderCooldownHours).toBe(72);
  });
});
