import { stabilizeRssTimestamps } from "../src/rss.js";

describe("rss timestamps", () => {
  const previous = [
    {
      id: 1,
      number: 1068,
      url: "https://github.com/rebase-network/who-is-hiring/issues/1068",
      title: "[Remote] Venturelabs is hiring a Community Manager",
      company: "Venturelabs",
      location: "Remote",
      salary: "$4,000 - $5,000",
      remote: true,
      work_mode: "Remote",
      timezone: "UTC+8",
      employment_type: "Full-time",
      responsibilities: "Grow and engage community channels.",
      contact_channels: ["email:jobs@example.com"],
      completeness_score: 80,
      completeness_grade: "B" as const,
      missing_fields: ["responsibilities"],
      state: "open",
      labels: ["jobs"],
      created_at: "2026-03-05T14:00:00.000Z",
      updated_at: "2026-03-07T09:30:00.000Z",
      rss_updated_at: "2026-03-06T10:00:00.000Z",
      closed_at: null,
      summary: "Venturelabs is an early-stage venture capital fund.",
      author: "alice",
    },
  ];

  it("keeps the previous RSS timestamp when only GitHub metadata changes", () => {
    const current = [
      {
        ...previous[0],
        updated_at: "2026-03-10T12:00:00.000Z",
        labels: ["jobs", "needs-info"],
      },
    ];

    const [job] = stabilizeRssTimestamps(current, previous, "2026-03-10T13:00:00.000Z");
    expect(job.rss_updated_at).toBe("2026-03-06T10:00:00.000Z");
  });

  it("bumps the RSS timestamp when the job content changes", () => {
    const current = [
      {
        ...previous[0],
        updated_at: "2026-03-10T12:00:00.000Z",
        salary: "$5,000 - $6,000",
      },
    ];

    const [job] = stabilizeRssTimestamps(current, previous, "2026-03-10T13:00:00.000Z");
    expect(job.rss_updated_at).toBe("2026-03-10T12:00:00.000Z");
  });
});
