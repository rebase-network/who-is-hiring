import { z } from "zod";
import { normalizedJobSchema, type NormalizedJob, type RichJob } from "./schemas.js";

type ConfidenceField = "company" | "location" | "salary" | "responsibilities" | "contact_channels";

const LOW_CONFIDENCE_THRESHOLD = 70;

const llmCandidateSchema = z.object({
  number: z.number().int(),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  salary: z.string().nullable().optional(),
  salary_min: z.number().nullable().optional(),
  salary_max: z.number().nullable().optional(),
  salary_currency: z.string().nullable().optional(),
  salary_period: z.string().nullable().optional(),
  work_mode: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  employment_type: z.string().nullable().optional(),
  responsibilities: z.string().nullable().optional(),
  contact_channels: z.array(z.string()).optional(),
  summary: z.string().optional(),
});

const llmResponseSchema = z.object({
  records: z.array(llmCandidateSchema),
});

type LlmResponsesApiResponse = {
  output?: Array<{ content?: Array<{ text?: string }> }>;
  output_text?: string;
};

type LlmChatCompletionsResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export type IssueExtractionTrace = {
  number: number;
  confidence_score: number;
  low_confidence: boolean;
  confidence_reasons: string[];
  deterministic_conflicts: string[];
  route: "llm-enriched" | "llm-fallback";
  llm_result: "applied" | "fallback";
  llm_attempted: boolean;
  llm_applied: boolean;
  llm_error: string | null;
  fallback_reason: string | null;
  merged_fields: string[];
};

export type ConfidenceAssessment = {
  score: number;
  lowConfidence: boolean;
  reasons: string[];
  conflicts: string[];
  fieldConfidence: Record<ConfidenceField, number>;
};

export async function enrichLowConfidenceRecords(params: {
  normalized: NormalizedJob[];
  rich: RichJob[];
  lowConfidenceThreshold?: number;
}): Promise<{ records: NormalizedJob[]; traces: IssueExtractionTrace[] }> {
  const threshold = params.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  const assessments = params.rich.map((job) => ({
    number: job.number,
    result: assessIssueConfidence(job, threshold),
  }));

  const assessmentsByNumber = new Map(assessments.map((item) => [item.number, item.result]));
  const richByNumber = new Map(params.rich.map((job) => [job.number, job]));

  const traces: IssueExtractionTrace[] = assessments.map(({ number, result }) => ({
    number,
    confidence_score: result.score,
    low_confidence: result.lowConfidence,
    confidence_reasons: result.reasons,
    deterministic_conflicts: result.conflicts,
    route: "llm-fallback",
    llm_result: "fallback",
    llm_attempted: false,
    llm_applied: false,
    llm_error: null,
    fallback_reason: null,
    merged_fields: [],
  }));

  const llmResult = await runLlmExtraction(params.normalized);
  if (!llmResult.ok) {
    for (const trace of traces) {
      trace.llm_attempted = llmResult.error === "missing-api-key" ? false : true;
      trace.route = "llm-fallback";
      trace.llm_result = "fallback";
      trace.llm_error = llmResult.error;
      trace.fallback_reason = llmResult.error;
    }
    return { records: params.normalized, traces };
  }

  const llmByNumber = new Map(llmResult.records.map((row) => [row.number, row]));
  const merged = params.normalized.map((job) => {
    const trace = traces.find((item) => item.number === job.number);
    if (trace) {
      trace.llm_attempted = true;
    }

    const candidate = llmByNumber.get(job.number);
    if (!candidate) {
      if (trace) {
        trace.route = "llm-fallback";
        trace.llm_result = "fallback";
        trace.llm_error = "missing-record-in-llm-output";
        trace.fallback_reason = "missing-record-in-llm-output";
      }
      return job;
    }

    const rich = richByNumber.get(job.number);
    const fieldConfidence = assessmentsByNumber.get(job.number)?.fieldConfidence;

    try {
      const mergedResult = mergeConservatively(job, candidate, rich, fieldConfidence);
      if (trace) {
        trace.route = mergedResult.applied ? "llm-enriched" : "llm-fallback";
        trace.llm_result = mergedResult.applied ? "applied" : "fallback";
        trace.llm_applied = mergedResult.applied;
        trace.merged_fields = mergedResult.mergedFields;
        trace.llm_error = mergedResult.applied ? null : "no-safe-fields-to-merge";
        trace.fallback_reason = mergedResult.applied ? null : "no-safe-fields-to-merge";
      }

      return mergedResult.record;
    } catch {
      if (trace) {
        trace.route = "llm-fallback";
        trace.llm_result = "fallback";
        trace.llm_error = "merge-validation-failed";
        trace.fallback_reason = "merge-validation-failed";
      }
      return job;
    }
  });

  return { records: merged, traces };
}

export function assessIssueConfidence(job: RichJob, threshold = LOW_CONFIDENCE_THRESHOLD): ConfidenceAssessment {
  let score = 100;
  const reasons: string[] = [];
  const conflicts: string[] = [];

  const fieldConfidence: Record<ConfidenceField, number> = {
    company: job.company ? 85 : 20,
    location: job.location ? 85 : 20,
    salary: job.salary ? 80 : 20,
    responsibilities: job.responsibilities.length > 0 ? 85 : 20,
    contact_channels: job.contact_details.length > 0 ? 85 : 20,
  };

  if (!job.company) {
    score -= 18;
    reasons.push("missing-company");
  }
  if (!job.location) {
    score -= 14;
    reasons.push("missing-location");
  }
  if (!job.salary) {
    score -= 12;
    reasons.push("missing-salary");
  }
  if (job.responsibilities.length === 0) {
    score -= 10;
    reasons.push("missing-responsibilities");
  }
  if (job.contact_details.length === 0) {
    score -= 12;
    reasons.push("missing-contact");
  }

  const salaryConflicts = detectSalaryConflicts(job);
  if (salaryConflicts.length) {
    score -= 18;
    conflicts.push(...salaryConflicts);
    reasons.push("conflicting-salary-signals");
    fieldConfidence.salary = Math.min(fieldConfidence.salary, 30);
  }

  const companyConflicts = detectCompanyConflicts(job);
  if (companyConflicts.length) {
    score -= 14;
    conflicts.push(...companyConflicts);
    reasons.push("conflicting-company-signals");
    fieldConfidence.company = Math.min(fieldConfidence.company, 35);
  }

  const locationConflicts = detectLocationConflicts(job);
  if (locationConflicts.length) {
    score -= 14;
    conflicts.push(...locationConflicts);
    reasons.push("conflicting-location-signals");
    fieldConfidence.location = Math.min(fieldConfidence.location, 35);
  }

  if (job.summary.trim().length < 40) {
    score -= 8;
    reasons.push("weak-summary-signal");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    lowConfidence: score < threshold,
    reasons,
    conflicts,
    fieldConfidence,
  };
}

async function runLlmExtraction(records: NormalizedJob[]): Promise<{ ok: true; records: z.infer<typeof llmCandidateSchema>[] } | { ok: false; error: string }> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "missing-api-key" };
  }

  const model = process.env.LLM_MODEL ?? "gpt-4.1-mini";
  const apiType = process.env.LLM_API_TYPE ?? "openai-responses";
  const configuredUrl = process.env.LLM_API_URL ?? "https://api.openai.com/v1/responses";
  const timeoutMs = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "60000", 10);
  const batchSizeRaw = Number.parseInt(process.env.LLM_BATCH_SIZE ?? "10", 10);
  const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? batchSizeRaw : 10;

  const responseUrl = normalizeResponsesUrl(configuredUrl);
  const chatUrl = normalizeChatCompletionsUrl(configuredUrl);

  // Try the configured API style first, then fallback to maximize relay compatibility.
  const attempts: Array<{ mode: "responses" | "chat"; url: string }> =
    apiType === "openai-chat-completions"
      ? [
          { mode: "chat", url: chatUrl },
          { mode: "responses", url: responseUrl },
        ]
      : [
          { mode: "responses", url: responseUrl },
          { mode: "chat", url: chatUrl },
        ];

  const aggregated: z.infer<typeof llmCandidateSchema>[] = [];
  for (let start = 0; start < records.length; start += batchSize) {
    const batch = records.slice(start, start + batchSize);

    let batchError = "llm-request-failed";
    let batchOk = false;
    for (const attempt of attempts) {
      const result = await requestLlm({
        mode: attempt.mode,
        url: attempt.url,
        apiKey,
        model,
        records: batch,
        timeoutMs,
      });

      if (result.ok) {
        aggregated.push(...result.records);
        batchOk = true;
        break;
      }

      batchError = normalizeLlmError(result.error);
      if (!isRetriableProtocolError(result.error)) {
        break;
      }
    }

    if (!batchOk) {
      return { ok: false, error: `${batchError}-batch-${Math.floor(start / batchSize) + 1}` };
    }
  }

  return { ok: true, records: aggregated };
}

async function requestLlm(params: {
  mode: "responses" | "chat";
  url: string;
  apiKey: string;
  model: string;
  records: NormalizedJob[];
  timeoutMs: number;
}): Promise<{ ok: true; records: z.infer<typeof llmCandidateSchema>[] } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = Number.isFinite(params.timeoutMs) && params.timeoutMs > 0 ? params.timeoutMs : 30000;
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeout);

  try {
    const response = await fetch(params.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        params.mode === "responses" ? buildResponsesPayload(params.model, params.records) : buildChatPayload(params.model, params.records),
      ),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await extractHttpErrorDetail(response);
      const suffix = detail ? `:${detail}` : "";
      return { ok: false, error: `llm-http-${response.status}-${params.mode}${suffix}` };
    }

    const contentType = response.headers?.get?.("content-type") ?? "application/json";
    const text = contentType.includes("text/event-stream")
      ? extractStreamJson(await response.text(), params.mode)
      : extractJsonFromPayload((await response.json()) as LlmResponsesApiResponse | LlmChatCompletionsResponse, params.mode);
    if (!text) {
      return { ok: false, error: `missing-llm-json-${params.mode}` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `llm-invalid-json-${params.mode}` };
    }

    const validated = llmResponseSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, error: `llm-schema-validation-failed-${params.mode}` };
    }

    return { ok: true, records: validated.data.records };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "llm-timeout" };
    }
    const message = error instanceof Error ? error.message.replace(/\s+/g, " ").trim().slice(0, 120) : "unknown";
    return { ok: false, error: `llm-request-failed-${params.mode}:${message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildResponsesPayload(model: string, records: NormalizedJob[]) {
  return {
    model,
    stream: true,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Extract structured job fields from low-confidence hiring issues. Keep issue number unchanged. Only return fields you can justify from the source text.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Return JSON object with key records. Input records are low-confidence parser output; refine only if confident.\n" + JSON.stringify(records),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "low_confidence_extractions",
        schema: {
          type: "object",
          properties: {
            records: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
          required: ["records"],
          additionalProperties: false,
        },
      },
    },
  };
}

function buildChatPayload(model: string, records: NormalizedJob[]) {
  return {
    model,
    stream: true,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Extract structured job fields from low-confidence hiring issues. Keep issue number unchanged. Only return fields you can justify from the source text.",
      },
      {
        role: "user",
        content: "Return JSON object with key records. Input records are low-confidence parser output; refine only if confident.\n" + JSON.stringify(records),
      },
    ],
  };
}

function normalizeResponsesUrl(configuredUrl: string): string {
  const clean = configuredUrl.trim().replace(/\/+$/, "");
  if (clean.endsWith("/responses")) {
    return clean;
  }
  if (clean.endsWith("/v1")) {
    return `${clean}/responses`;
  }
  return `${clean}/v1/responses`;
}

function normalizeChatCompletionsUrl(configuredUrl: string): string {
  const clean = configuredUrl.trim().replace(/\/+$/, "");
  if (clean.endsWith("/chat/completions")) {
    return clean;
  }
  if (clean.endsWith("/responses")) {
    return clean.replace(/\/responses$/, "/chat/completions");
  }
  if (clean.endsWith("/v1")) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

function isRetriableProtocolError(error: string): boolean {
  return /llm-http-(400|404)-/.test(error);
}

function normalizeLlmError(error: string): string {
  return error.replace(/-(responses|chat)(?=:|$)/u, "");
}

async function extractHttpErrorDetail(response: Response): Promise<string | null> {
  try {
    const raw = await response.text();
    if (!raw) {
      return null;
    }

    let text = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string }; message?: string };
      text = parsed.error?.message ?? parsed.message ?? raw;
    } catch {
      // Keep plain-text response bodies as-is.
    }

    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) {
      return null;
    }
    return compact.slice(0, 180);
  } catch {
    return null;
  }
}

function mergeConservatively(
  base: NormalizedJob,
  candidate: z.infer<typeof llmCandidateSchema>,
  rich: RichJob | undefined,
  fieldConfidence?: Record<ConfidenceField, number>,
): { record: NormalizedJob; applied: boolean; mergedFields: string[] } {
  const next: NormalizedJob = normalizedJobSchema.parse({ ...base });
  const mergedFields: string[] = [];

  if (looksLikeCompanyName(candidate.company)) {
    maybeMerge("company", base.company, candidate.company, 0.95);
  }
  maybeMerge("location", base.location, candidate.location, 0.95);
  maybeMerge("salary", base.salary, candidate.salary, 0.9);
  maybeMerge("work_mode", base.work_mode ?? null, candidate.work_mode ?? null, 0.85);
  maybeMerge("timezone", base.timezone ?? null, candidate.timezone ?? null, 0.85);
  maybeMerge("employment_type", base.employment_type ?? null, candidate.employment_type ?? null, 0.85);
  maybeMerge("responsibilities", base.responsibilities ?? null, candidate.responsibilities ?? null, 0.95);

  if (Array.isArray(candidate.contact_channels) && candidate.contact_channels.length > 0) {
    const merged = Array.from(new Set([...(base.contact_channels ?? []), ...candidate.contact_channels]));
    if (merged.length > (base.contact_channels ?? []).length) {
      next.contact_channels = merged;
      mergedFields.push("contact_channels");
    }
  }

  if ((base.salary_min == null || (fieldConfidence?.salary ?? 0) < 70) && candidate.salary_min != null) {
    next.salary_min = candidate.salary_min;
    mergedFields.push("salary_min");
  }
  if ((base.salary_max == null || (fieldConfidence?.salary ?? 0) < 70) && candidate.salary_max != null) {
    next.salary_max = candidate.salary_max;
    mergedFields.push("salary_max");
  }
  if ((base.salary_currency == null || (fieldConfidence?.salary ?? 0) < 70) && candidate.salary_currency != null) {
    next.salary_currency = candidate.salary_currency;
    mergedFields.push("salary_currency");
  }
  if ((base.salary_period == null || (fieldConfidence?.salary ?? 0) < 70) && candidate.salary_period != null) {
    next.salary_period = candidate.salary_period;
    mergedFields.push("salary_period");
  }

  if ((base.summary?.length ?? 0) < 40 && typeof candidate.summary === "string" && candidate.summary.trim().length >= 40) {
    next.summary = candidate.summary.trim().slice(0, 400);
    mergedFields.push("summary");
  }

  if (!next.salary && rich?.salary) {
    next.salary = rich.salary;
  }

  return {
    record: normalizedJobSchema.parse(next),
    applied: mergedFields.length > 0,
    mergedFields,
  };

  function maybeMerge<K extends keyof NormalizedJob>(
    key: K,
    existing: string | null,
    incoming: string | null | undefined,
    requiredImprovementRatio: number,
  ): void {
    const candidateValue = clean(incoming);
    const existingValue = clean(existing);
    if (!candidateValue || candidateValue === existingValue) {
      return;
    }

    const confidenceKey = key as ConfidenceField;
    const hasHighDeterministicConfidence = fieldConfidence && confidenceKey in fieldConfidence && fieldConfidence[confidenceKey] >= 75;

    if (existingValue && hasHighDeterministicConfidence) {
      const clearer = candidateValue.length > Math.max(12, Math.floor(existingValue.length * requiredImprovementRatio));
      const existingLooksWeak = /^(remote|n\/a|na|none|unknown)$/i.test(existingValue);
      if (!clearer && !existingLooksWeak) {
        return;
      }
    }

    (next as Record<string, unknown>)[key] = candidateValue;
    mergedFields.push(String(key));
  }
}

function looksLikeCompanyName(value: string | null | undefined): boolean {
  const v = clean(value);
  if (!v) {
    return false;
  }

  if (v.length > 40) {
    return false;
  }

  // Reject sentence-like content often produced by over-eager extraction.
  if (/[。；;!?！？]/.test(v)) {
    return false;
  }

  if (/(?:负责|确保|能力|经验|要求|岗位职责|任职要求)/.test(v)) {
    return false;
  }

  return true;
}

function detectSalaryConflicts(job: RichJob): string[] {
  const snippets = [job.salary ?? "", ...job.compensation_notes].join("\n");
  const matches = snippets.match(/\b(?:USD|USDT|CNY|RMB|HKD|SGD|EUR|GBP|TWD)\b|[$¥￥]/gi) ?? [];
  const currencies = new Set(matches.map((token) => normalizeCurrencyToken(token)));
  const cleanCurrencies = Array.from(currencies).filter(Boolean);
  const conflicts: string[] = [];
  if (cleanCurrencies.length >= 2) {
    conflicts.push(`salary-multi-currency:${cleanCurrencies.join(",")}`);
  }
  if (job.salary_min != null && job.salary_max != null && job.salary_min > job.salary_max) {
    conflicts.push("salary-min-gt-max");
  }
  return conflicts;
}

function detectCompanyConflicts(job: RichJob): string[] {
  const body = job.raw_body ?? "";
  const matches = Array.from(body.matchAll(/(?:company|公司(?:名称)?)\s*[:：]\s*([^\n]+)/gi)).map((m) => clean(m[1]));
  const uniqValues = Array.from(new Set(matches.filter(Boolean)));
  return uniqValues.length >= 2 ? ["company-multiple-labeled-values"] : [];
}

function detectLocationConflicts(job: RichJob): string[] {
  const body = job.raw_body ?? "";
  const matches = Array.from(body.matchAll(/(?:location|地点|工作地点|城市)\s*[:：]\s*([^\n]+)/gi)).map((m) => clean(m[1]));
  const uniqValues = Array.from(new Set(matches.filter(Boolean)));
  return uniqValues.length >= 2 ? ["location-multiple-labeled-values"] : [];
}

function normalizeCurrencyToken(value: string): string {
  const token = value.toUpperCase();
  if (token === "$") return "USD";
  if (token === "¥" || token === "￥") return "CNY";
  if (token === "RMB") return "CNY";
  return token;
}

function clean(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact || null;
}

function extractJsonFromPayload(payload: LlmResponsesApiResponse | LlmChatCompletionsResponse, mode: "responses" | "chat"): string | null {
  if (mode === "responses") {
    return extractResponsesJson(payload as LlmResponsesApiResponse);
  }
  return extractChatJson(payload as LlmChatCompletionsResponse);
}

function extractResponsesJson(payload: LlmResponsesApiResponse): string | null {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return typeof payload.output_text === "string" ? payload.output_text : null;
}

function extractChatJson(payload: LlmChatCompletionsResponse): string | null {
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : null;
}

function extractStreamJson(raw: string, mode: "responses" | "chat"): string | null {
  const lines = raw.split("\n");
  const chunks: string[] = [];
  let fallback: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }

    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    if (mode === "chat") {
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") {
        chunks.push(delta);
      }
      continue;
    }

    if (typeof parsed?.delta === "string") {
      chunks.push(parsed.delta);
    }
    if (typeof parsed?.output_text === "string") {
      fallback = parsed.output_text;
    }
    if (parsed?.response) {
      const extracted = extractResponsesJson(parsed.response as LlmResponsesApiResponse);
      if (extracted) {
        fallback = extracted;
      }
    }
  }

  if (chunks.length > 0) {
    return chunks.join("");
  }
  return fallback;
}
