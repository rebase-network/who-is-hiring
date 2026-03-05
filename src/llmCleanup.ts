import { NormalizedJob, normalizedJobSchema } from "./schemas.js";

const SYSTEM_PROMPT =
  "You clean and normalize hiring job records. Keep meaning intact, trim spam, fix obvious formatting noise, and output strict JSON.";

type LlmResponse = {
  output?: Array<{ content?: Array<{ text?: string }> }>;
  output_text?: string;
};

export async function cleanupRecords(records: NormalizedJob[]): Promise<NormalizedJob[]> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return records;
  }

  const url = process.env.LLM_API_URL ?? "https://api.openai.com/v1/responses";
  const model = process.env.LLM_MODEL ?? "gpt-4.1-mini";

  const userPrompt =
    "Normalize these hiring records and return a JSON object with key 'records'. Keep all ids and issue numbers unchanged. Input:\n" +
    JSON.stringify(records);

  const payload = {
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      { role: "user", content: [{ type: "input_text", text: userPrompt }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "cleaned_records",
        schema: {
          type: "object",
          properties: {
            records: {
              type: "array",
              items: { type: "object" },
            },
          },
          required: ["records"],
          additionalProperties: false,
        },
      },
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return records;
    }

    const raw = (await response.json()) as LlmResponse;
    const cleanedJson = extractJson(raw);
    if (!cleanedJson) {
      return records;
    }

    const parsed = JSON.parse(cleanedJson) as { records?: unknown };
    if (!Array.isArray(parsed.records)) {
      return records;
    }

    return parsed.records.map((record) => normalizedJobSchema.parse(record));
  } catch {
    return records;
  }
}

function extractJson(payload: LlmResponse): string | null {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return typeof payload.output_text === "string" ? payload.output_text : null;
}
