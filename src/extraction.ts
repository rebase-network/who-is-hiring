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

type LlmResponse = {
  output?: Array<{ content?: Array<{ text?: string }> }>;
  output_text?: string;
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

  const url = process.env.LLM_API_URL ?? "https://api.openai.com/v1/responses";
  const model = process.env.LLM_MODEL ?? "gpt-4.1-mini";
  const timeoutMs = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "30000", 10);
  const payload = {
    model,
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
            text:
              "Return JSON object with key records. Input records are low-confidence parser output; refine only if confident.\n" +
              JSON.stringify(records),
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

  const controller = new AbortController();
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `llm-http-${response.status}` };
    }

    const raw = (await response.json()) as LlmResponse;
    const text = extractJson(raw);
    if (!text) {
      return { ok: false, error: "missing-llm-json" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: "llm-invalid-json" };
    }

    const validated = llmResponseSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, error: "llm-schema-validation-failed" };
    }

    return { ok: true, records: validated.data.records };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "llm-timeout" };
    }
    return { ok: false, error: "llm-request-failed" };
  } finally {
    clearTimeout(timeoutId);
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

  maybeMerge("company", base.company, candidate.company, 0.95);
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
