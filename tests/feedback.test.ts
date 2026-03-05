import {
  computeCompleteness,
  createInitialFeedbackState,
  evaluateLowScoreLabeling,
  resolveFeedbackConfig,
} from "../src/feedback.js";

describe("computeCompleteness", () => {
  it("scores complete issues at 100", () => {
    const result = computeCompleteness({
      company: "Acme",
      location: "Remote",
      salary: "5k-7k USD",
      responsibilities: "Build backend services",
      contact_channels: ["email:jobs@acme.dev"],
    });

    expect(result).toEqual({
      score: 100,
      grade: "A",
      missing_fields: [],
    });
  });

  it("reports missing fields and lower grade", () => {
    const result = computeCompleteness({
      company: "Acme",
      location: null,
      salary: null,
      responsibilities: null,
      contact_channels: [],
    });

    expect(result.score).toBe(20);
    expect(result.grade).toBe("F");
    expect(result.missing_fields).toEqual(["location", "salary", "responsibilities", "contact"]);
  });
});

describe("evaluateLowScoreLabeling", () => {
  it("adds needs-info on low-score open issues that do not have the label", () => {
    const state = createInitialFeedbackState();
    const decision = evaluateLowScoreLabeling({
      issueNumber: 42,
      isOpen: true,
      labels: ["jobs"],
      completeness: { score: 40, grade: "F", missing_fields: ["salary"] },
      config: { lowScoreThreshold: 60, reminderCooldownHours: 72 },
      state,
      now: new Date("2026-03-05T12:00:00Z"),
    });

    expect(decision.shouldEnsureLabel).toBe(true);
    expect(decision.shouldAddLabel).toBe(true);
    expect(decision.shouldScheduleReminder).toBe(false);
    expect(state.issues["42"]?.last_labeled_at).toBe("2026-03-05T12:00:00.000Z");
  });

  it("is idempotent when the label is already present", () => {
    const state = createInitialFeedbackState();
    state.issues["42"] = {
      last_labeled_at: "2026-03-04T00:00:00.000Z",
      last_reminded_at: null,
      last_score: 50,
    };

    const decision = evaluateLowScoreLabeling({
      issueNumber: 42,
      isOpen: true,
      labels: ["jobs", "needs-info"],
      completeness: { score: 50, grade: "F", missing_fields: ["salary"] },
      config: { lowScoreThreshold: 60, reminderCooldownHours: 72 },
      state,
      now: new Date("2026-03-05T12:00:00Z"),
    });

    expect(decision.shouldEnsureLabel).toBe(true);
    expect(decision.shouldAddLabel).toBe(false);
    expect(decision.reason).toBe("cooldown-elapsed");
  });

  it("skips labeling closed issues", () => {
    const decision = evaluateLowScoreLabeling({
      issueNumber: 99,
      isOpen: false,
      labels: [],
      completeness: { score: 10, grade: "F", missing_fields: ["company"] },
      config: { lowScoreThreshold: 60, reminderCooldownHours: 72 },
      state: createInitialFeedbackState(),
      now: new Date("2026-03-05T12:00:00Z"),
    });

    expect(decision.shouldAddLabel).toBe(false);
    expect(decision.reason).toBe("issue-closed");
  });

  it("tracks cooldown-active state without relabeling", () => {
    const state = createInitialFeedbackState();
    state.issues["99"] = {
      last_labeled_at: "2026-03-04T00:00:00.000Z",
      last_reminded_at: "2026-03-05T10:30:00.000Z",
      last_score: 30,
    };

    const decision = evaluateLowScoreLabeling({
      issueNumber: 99,
      isOpen: true,
      labels: ["needs-info"],
      completeness: { score: 30, grade: "F", missing_fields: ["company"] },
      config: { lowScoreThreshold: 60, reminderCooldownHours: 72 },
      state,
      now: new Date("2026-03-05T12:00:00Z"),
    });

    expect(decision.shouldAddLabel).toBe(false);
    expect(decision.shouldScheduleReminder).toBe(false);
    expect(decision.reason).toBe("cooldown-active");
  });
});

describe("resolveFeedbackConfig", () => {
  it("uses defaults when env vars are missing", () => {
    const config = resolveFeedbackConfig({});
    expect(config.lowScoreThreshold).toBe(60);
    expect(config.reminderCooldownHours).toBe(72);
  });
});
