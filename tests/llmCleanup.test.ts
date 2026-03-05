import { cleanupRecords } from "../src/llmCleanup.js";
import type { NormalizedJob } from "../src/schemas.js";

describe("cleanupRecords", () => {
  it("is noop without api key", async () => {
    delete process.env.LLM_API_KEY;
    const records: NormalizedJob[] = [
      {
        id: 1,
        number: 1,
        url: "https://example.com/1",
        title: "x",
        company: null,
        location: null,
        salary: null,
        remote: false,
        completeness_score: 0,
        completeness_grade: "F",
        missing_fields: ["company", "location", "salary", "responsibilities", "contact"],
        state: "open",
        labels: [],
        created_at: null,
        updated_at: null,
        closed_at: null,
        summary: "",
        author: null,
      },
    ];

    await expect(cleanupRecords(records)).resolves.toEqual(records);
  });
});
