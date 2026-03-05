import { cleanupRecords } from "../src/llmCleanup.js";

describe("cleanupRecords", () => {
  it("is noop without api key", async () => {
    delete process.env.LLM_API_KEY;
    const records = [
      {
        id: 1,
        number: 1,
        url: "https://example.com/1",
        title: "x",
        company: null,
        location: null,
        salary: null,
        remote: false,
        state: "open",
        labels: [],
        created_at: null,
        updated_at: null,
        closed_at: null,
        summary: "",
        raw_body: "",
        author: null,
      },
    ];

    await expect(cleanupRecords(records)).resolves.toEqual(records);
  });
});
