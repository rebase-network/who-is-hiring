import { z } from "zod";
import { computeCompleteness } from "./feedback.js";
import { normalizedJobSchema, type NormalizedJob, type RichJob } from "./schemas.js";

type ConfidenceField = "company" | "location" | "salary" | "responsibilities" | "requirements" | "contact_channels";

type EvidenceField =
  | "company"
  | "location"
  | "salary"
  | "work_mode"
  | "timezone"
  | "employment_type"
  | "responsibilities"
  | "requirements"
  | "contact_channels";

const LOW_CONFIDENCE_THRESHOLD = 70;

const evidenceSchema = z.object({
  company: z.string().nullable(),
  location: z.string().nullable(),
  salary: z.string().nullable(),
  work_mode: z.string().nullable(),
  timezone: z.string().nullable(),
  employment_type: z.string().nullable(),
  responsibilities: z.string().nullable(),
  requirements: z.string().nullable(),
  contact_channels: z.string().nullable(),
});

const sourceTypeSchema = z.enum(["title", "body", "author_comment", "derived", "none"]);
const sourceMapSchema = z.object({
  company: sourceTypeSchema.nullable(),
  location: sourceTypeSchema.nullable(),
  salary: sourceTypeSchema.nullable(),
  work_mode: sourceTypeSchema.nullable(),
  timezone: sourceTypeSchema.nullable(),
  employment_type: sourceTypeSchema.nullable(),
  responsibilities: sourceTypeSchema.nullable(),
  requirements: sourceTypeSchema.nullable(),
  contact_channels: sourceTypeSchema.nullable(),
});

const llmCommentSchema = z.object({
  body: z.string().nullable(),
  author: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

const llmSourceIssueSchema = z.object({
  number: z.number().int(),
  url: z.string().url(),
  title: z.string(),
  body: z.string().nullable(),
  comments: z.array(llmCommentSchema),
  labels: z.array(z.string()),
  state: z.string(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  author: z.string().nullable(),
});

const llmInputRecordSchema = z.object({
  issue: llmSourceIssueSchema,
  normalized_hint: z.object({
    company: z.string().nullable(),
    location: z.string().nullable(),
    salary: z.string().nullable(),
    salary_min: z.number().nullable(),
    salary_max: z.number().nullable(),
    salary_currency: z.string().nullable(),
    salary_period: z.string().nullable(),
    work_mode: z.string().nullable(),
    timezone: z.string().nullable(),
    employment_type: z.string().nullable(),
    responsibilities: z.string().nullable(),
    requirements: z.string().nullable(),
    contact_channels: z.array(z.string()),
    summary: z.string(),
  }),
  rich_hint: z.object({
    responsibilities_lines: z.array(z.string()),
    requirement_lines: z.array(z.string()),
    contact_detail_lines: z.array(z.string()),
    compensation_lines: z.array(z.string()),
    section_titles: z.array(z.string()),
    narrative_paragraphs: z.array(z.string()),
  }),
  field_focus: z.object({
    missing_fields: z.array(z.string()),
    weak_fields: z.array(z.string()),
    risk_flags: z.array(z.string()),
  }),
});

export type LlmInputIssueRecord = z.infer<typeof llmInputRecordSchema>;

const llmCandidateSchema = z.object({
  number: z.number().int(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  salary: z.string().nullable(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable(),
  salary_period: z.string().nullable(),
  work_mode: z.string().nullable(),
  timezone: z.string().nullable(),
  employment_type: z.string().nullable(),
  responsibilities: z.string().nullable(),
  requirements: z.string().nullable(),
  contact_channels: z.array(z.string()),
  summary: z.string().nullable(),
  evidence: evidenceSchema,
  source_map: sourceMapSchema,
});

const llmResponseSchema = z.object({
  records: z.array(llmCandidateSchema),
});

const EXTRACTION_SYSTEM_PROMPT = [
  "Extract structured hiring fields from low-confidence GitHub job issues.",
  "Use source priority: issue.title -> issue.body -> issue author comments -> labels/metadata -> hints.",
  "Only comments written by the issue author may be used as official supplemental data.",
  "Keep the issue number unchanged.",
  "Unknown values must be explicit null.",
  "Do not invent facts that are not supported by the issue.",
  "Return evidence snippets and source_map for every extracted field.",
  "Use field_focus to prioritize filling missing and weak candidate-facing fields first.",
  "When field_focus says a field is missing or weak, actively search title/body/author-comments for stronger evidence before trusting normalized_hint.",
  "Field expectations:",
  "- company: hiring organization, team, studio, platform, exchange, employer, or named project. Valid examples: 'Term Structure Labs', 'AI金融平台', '游戏集团', 'Top20 加密交易所'. Invalid examples: '明星团队背书', '资本与市场认可', generic culture copy, or pure role descriptions.",
  "- location: city, country, region, bracketed title location, or remote region constraint. Capture concrete phrases like '[杭州]', 'Taipei', 'Remote/Singapore', 'base杭州'.",
  "- salary: preserve the clearest compensation snippet; prefer numeric/title clues over vague 'negotiable' or '面议'. Valid examples: '25K+', '5000-8000 USD', '24000-70000 USD/year', '6000-10000 USDT/月'. If both numeric and vague salary exist, keep the numeric one.",
  "- work_mode: capture remote / hybrid / onsite / 现场办公 / 居家办公 / 远端 / 半远端 / 远程办公 / 线下办公 signals. Keep the clearest phrase from the issue.",
  "- employment_type: capture full-time / part-time / contract / intern and signals like 工作性质, Job Nature, 是否全职：是, 全职，优先考虑..., 工时, 月休. If schedule hints strongly imply a normal staffed role, full-time is acceptable. If there is no real evidence, return null.",
  "- responsibilities: capture the actual job duties, tasks, ownership, or deliverables, especially under headings like 你负责 / 你需要搞定 / 核心挑战 / 职责 / Responsibilities. Prefer action-heavy lines over marketing copy.",
  "- requirements: capture candidate qualifications, skills, years of experience, stack familiarity, domain expertise, and bonus qualifications under headings like 我们需要的你 / 我们希望你 / 任职要求 / Requirements / 加分项. Exclude employer self-description and financing/team brag paragraphs.",
  "- contact_channels: include concrete contact or application routes such as email, telegram handle, wechat id, form link, careers page, or website application link. Prefer concrete identifiers like '@name', 'jobs@example.com', 'https://apply...' over generic words like just 'telegram' or just 'wechat'.",
  "Important constraints:",
  "- Never treat contact handles, phone numbers, or messaging IDs as salary.",
  "- Do not downgrade a numeric salary just because the body also contains weaker text like 'negotiable' or '面议'.",
  "- Prefer concrete candidate-facing information over employer marketing copy.",
  "- Ignore non-author comments entirely.",
  "- For contact_channels, keep concrete routes and avoid low-information placeholders when a more specific route exists in the issue.",
].join(" ");

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
  loadComments?: (issueNumber: number) => Promise<Array<{ body: string | null; author?: string | null; created_at?: string | null; updated_at?: string | null }>>;
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

  const lowConfidenceRecords = params.normalized.filter((job) => assessmentsByNumber.get(job.number)?.lowConfidence);
  const llmInputRecords = await Promise.all(
    lowConfidenceRecords.map(async (job) => {
      const rich = richByNumber.get(job.number);
      return toLlmInputRecord(job, rich, params.loadComments);
    }),
  );

  const llmResult = await runLlmExtraction(llmInputRecords);
  if (!llmResult.ok) {
    for (const trace of traces) {
      const lowConfidence = assessmentsByNumber.get(trace.number)?.lowConfidence ?? false;
      if (!lowConfidence) {
        trace.llm_attempted = false;
        trace.route = "llm-fallback";
        trace.llm_result = "fallback";
        trace.llm_error = null;
        trace.fallback_reason = "high-confidence-skip-llm";
        continue;
      }

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
    const assessment = assessmentsByNumber.get(job.number);
    if (!assessment?.lowConfidence) {
      if (trace) {
        trace.llm_attempted = false;
        trace.route = "llm-fallback";
        trace.llm_result = "fallback";
        trace.llm_error = null;
        trace.fallback_reason = "high-confidence-skip-llm";
      }
      return job;
    }

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
    requirements: job.requirements.length > 0 ? 80 : 20,
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
  if (job.requirements.length === 0) {
    score -= 8;
    reasons.push("missing-requirements");
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

async function runLlmExtraction(records: LlmInputIssueRecord[]): Promise<{ ok: true; records: z.infer<typeof llmCandidateSchema>[] } | { ok: false; error: string }> {
  if (records.length === 0) {
    return { ok: true, records: [] };
  }

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
  const batchCount = Math.ceil(records.length / batchSize);

  process.stdout.write(`[extraction] llm_candidates=${records.length} llm_batch_size=${batchSize} llm_batch_count=${batchCount}\n`);

  const responseUrl = normalizeResponsesUrl(configuredUrl);
  const chatUrl = normalizeChatCompletionsUrl(configuredUrl);

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
  let hadBatchFailure = false;
  let lastBatchError = "llm-request-failed";

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
      hadBatchFailure = true;
      lastBatchError = `${batchError}-batch-${Math.floor(start / batchSize) + 1}`;
      continue;
    }
  }

  if (aggregated.length === 0 && hadBatchFailure) {
    return { ok: false, error: lastBatchError };
  }

  return { ok: true, records: aggregated };
}

async function requestLlm(params: {
  mode: "responses" | "chat";
  url: string;
  apiKey: string;
  model: string;
  records: LlmInputIssueRecord[];
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

function buildResponsesPayload(model: string, records: LlmInputIssueRecord[]) {
  return {
    model,
    stream: true,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: EXTRACTION_SYSTEM_PROMPT,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Return JSON object with key records. Each record must include all output fields, evidence object, and source_map object (nullable values). Unknown values must be null, not omitted. " +
              "Each input record is a raw issue-first payload with issue (authoritative raw source), normalized_hint (lightweight parser output), rich_hint (section titles, extracted bullet lines, narrative paragraphs, compensation/contact hints), and field_focus (missing/weak/risk fields to prioritize). " +
              "Use hints to find evidence faster, but do not let hints override explicit issue text. Input records:\n" + JSON.stringify(records),
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
                properties: {
                  number: { type: "integer" },
                  company: { type: ["string", "null"] },
                  location: { type: ["string", "null"] },
                  salary: { type: ["string", "null"] },
                  salary_min: { type: ["number", "null"] },
                  salary_max: { type: ["number", "null"] },
                  salary_currency: { type: ["string", "null"] },
                  salary_period: { type: ["string", "null"] },
                  work_mode: { type: ["string", "null"] },
                  timezone: { type: ["string", "null"] },
                  employment_type: { type: ["string", "null"] },
                  responsibilities: { type: ["string", "null"] },
                  requirements: { type: ["string", "null"] },
                  contact_channels: { type: "array", items: { type: "string" } },
                  summary: { type: ["string", "null"] },
                  evidence: {
                    type: "object",
                    properties: {
                      company: { type: ["string", "null"] },
                      location: { type: ["string", "null"] },
                      salary: { type: ["string", "null"] },
                      work_mode: { type: ["string", "null"] },
                      timezone: { type: ["string", "null"] },
                      employment_type: { type: ["string", "null"] },
                      responsibilities: { type: ["string", "null"] },
                      requirements: { type: ["string", "null"] },
                      contact_channels: { type: ["string", "null"] },
                    },
                    required: ["company", "location", "salary", "work_mode", "timezone", "employment_type", "responsibilities", "requirements", "contact_channels"],
                    additionalProperties: false,
                  },
                  source_map: {
                    type: "object",
                    properties: {
                      company: { type: ["string", "null"], enum: ["title", "body", "author_comment", "derived", "none", null] },
                      location: { type: ["string", "null"], enum: ["title", "body", "author_comment", "derived", "none", null] },
                      salary: { type: ["string", "null"], enum: ["title", "body", "author_comment", "derived", "none", null] },
                      work_mode: { type: ["string", "null"], enum: ["title", "body", "author_comment", "derived", "none", null] },
                      timezone: { type: ["string", "null"], enum: ["title", "body", "author_comment", "derived", "none", null] },
                      employment_type: { type: ["string", "null"], enum: ["title", "body", "author_comment", "derived", "none", null] },
                      responsibilities: { type: ["string", "null"], enum: ["title", "body", "author_comment", "derived", "none", null] },
                      requirements: { type: ["string", "null"], enum: ["title", "body", "author_comment", "derived", "none", null] },
                      contact_channels: { type: ["string", "null"], enum: ["title", "body", "author_comment", "derived", "none", null] }
                    },
                    required: ["company", "location", "salary", "work_mode", "timezone", "employment_type", "responsibilities", "requirements", "contact_channels"],
                    additionalProperties: false
                  },
                },
                required: [
                  "number",
                  "company",
                  "location",
                  "salary",
                  "salary_min",
                  "salary_max",
                  "salary_currency",
                  "salary_period",
                  "work_mode",
                  "timezone",
                  "employment_type",
                  "responsibilities",
                  "requirements",
                  "contact_channels",
                  "summary",
                  "evidence",
                  "source_map",
                ],
                additionalProperties: false,
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

function buildChatPayload(model: string, records: LlmInputIssueRecord[]) {
  return {
    model,
    stream: true,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: EXTRACTION_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content:
          "Return JSON object with key records. Each record must include all output fields, evidence object, and source_map object (nullable values). Unknown values must be null, not omitted. " +
          "Each input record is a raw issue-first payload with issue (authoritative raw source), normalized_hint (lightweight parser output), rich_hint (section titles, extracted bullet lines, narrative paragraphs, compensation/contact hints), and field_focus (missing/weak/risk fields to prioritize). " +
          "Use hints to find evidence faster, but do not let hints override explicit issue text. Input records:\n" + JSON.stringify(records),
      },
    ],
  };
}

async function toLlmInputRecord(
  normalized: NormalizedJob,
  rich: RichJob | undefined,
  loadComments:
    | ((issueNumber: number) => Promise<Array<{ body: string | null; author?: string | null; created_at?: string | null; updated_at?: string | null }>>)
    | undefined,
): Promise<LlmInputIssueRecord> {
  const commentsRaw = loadComments ? await loadComments(normalized.number) : [];
  const issueAuthor = normalized.author ?? rich?.author ?? null;
  const comments = commentsRaw
    .filter((comment) => issueAuthor && typeof comment.author === "string" && comment.author === issueAuthor)
    .map((comment) => ({
      body: typeof comment.body === "string" ? comment.body : null,
      author: typeof comment.author === "string" ? comment.author : null,
      created_at: typeof comment.created_at === "string" ? comment.created_at : null,
      updated_at: typeof comment.updated_at === "string" ? comment.updated_at : null,
    }));

  return llmInputRecordSchema.parse({
    issue: {
      number: normalized.number,
      url: normalized.url,
      title: normalized.title,
      body: rich?.raw_body ?? null,
      comments,
      labels: normalized.labels,
      state: normalized.state,
      created_at: normalized.created_at ?? null,
      updated_at: normalized.updated_at ?? null,
      closed_at: normalized.closed_at ?? null,
      author: normalized.author ?? null,
    },
    normalized_hint: {
      company: normalized.company,
      location: normalized.location,
      salary: normalized.salary,
      salary_min: normalized.salary_min ?? null,
      salary_max: normalized.salary_max ?? null,
      salary_currency: normalized.salary_currency ?? null,
      salary_period: normalized.salary_period ?? null,
      work_mode: normalized.work_mode ?? null,
      timezone: normalized.timezone ?? null,
      employment_type: normalized.employment_type ?? null,
      responsibilities: normalized.responsibilities ?? null,
      requirements: normalized.requirements ?? null,
      contact_channels: normalized.contact_channels ?? [],
      summary: normalized.summary,
    },
    rich_hint: {
      responsibilities_lines: rich?.responsibilities ?? [],
      requirement_lines: rich?.requirements ?? [],
      contact_detail_lines: rich?.contact_details ?? [],
      compensation_lines: rich?.compensation_notes ?? [],
      section_titles: rich?.sections.map((section) => section.title) ?? [],
      narrative_paragraphs: rich?.narrative ?? [],
    },
    field_focus: {
      missing_fields: normalized.missing_fields ?? [],
      weak_fields: normalized.weak_fields ?? [],
      risk_flags: normalized.risk_flags ?? [],
    },
  });
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
  next.field_sources = { ...(base.field_sources ?? {}) };
  next.comment_supplemented_fields = [...(base.comment_supplemented_fields ?? [])];

  if (looksLikeCompanyName(candidate.company)) {
    maybeMerge("company", base.company, candidate.company, 0.95);
  }
  maybeMerge("location", base.location, candidate.location, 0.95);
  maybeMergeSalary(base.salary, candidate.salary, candidate.evidence.salary, 0.9);
  maybeMerge("work_mode", base.work_mode ?? null, candidate.work_mode ?? null, 0.85);
  maybeMerge("timezone", base.timezone ?? null, candidate.timezone ?? null, 0.85);
  maybeMerge("employment_type", base.employment_type ?? null, candidate.employment_type ?? null, 0.85);
  maybeMerge("responsibilities", base.responsibilities ?? null, candidate.responsibilities ?? null, 0.95);
  maybeMerge("requirements", base.requirements ?? null, candidate.requirements ?? null, 0.95);

  if (Array.isArray(candidate.contact_channels) && candidate.contact_channels.length > 0) {
    const merged = Array.from(new Set([...(base.contact_channels ?? []), ...candidate.contact_channels]));
    if (merged.length > (base.contact_channels ?? []).length) {
      next.contact_channels = merged;
      mergedFields.push("contact_channels");
      applySource("contact_channels");
    }
  }

  if ((base.salary_min == null || (fieldConfidence?.salary ?? 0) < 70) && candidate.salary_min != null && isLikelySalaryNumber(candidate.salary_min)) {
    next.salary_min = candidate.salary_min;
    mergedFields.push("salary_min");
  }
  if ((base.salary_max == null || (fieldConfidence?.salary ?? 0) < 70) && candidate.salary_max != null && isLikelySalaryNumber(candidate.salary_max)) {
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

  const completeness = computeCompleteness({
    title: next.title,
    company: next.company,
    location: next.location,
    salary: next.salary,
    salary_currency: next.salary_currency,
    salary_period: next.salary_period,
    work_mode: next.work_mode,
    employment_type: next.employment_type,
    responsibilities: next.responsibilities,
    requirements: next.requirements,
    contact_channels: next.contact_channels,
    field_sources: next.field_sources,
    risk_flags: next.risk_flags,
  });

  next.completeness_score = completeness.score;
  next.completeness_grade = completeness.grade;
  next.missing_fields = completeness.missing_fields;
  next.weak_fields = completeness.weak_fields;
  next.risk_flags = completeness.risk_flags;
  next.score_breakdown = completeness.score_breakdown;
  next.decision_value_score = completeness.decision_value_score;
  next.credibility_score = completeness.credibility_score;
  next.comment_supplemented_fields = Array.from(new Set(next.comment_supplemented_fields));

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
    const fieldName = String(key);
    const existingSource = next.field_sources?.[fieldName] ?? null;
    const candidateSource = candidate.source_map?.[fieldName as keyof typeof candidate.source_map] ?? null;
    const candidateBeatsSource = sourcePriority(candidateSource) > sourcePriority(existingSource);

    if (existingValue && hasHighDeterministicConfidence) {
      const clearer = candidateValue.length > Math.max(12, Math.floor(existingValue.length * requiredImprovementRatio));
      const existingLooksWeak = /^(remote|n\/a|na|none|unknown)$/i.test(existingValue);
      if (!clearer && !existingLooksWeak && !candidateBeatsSource) {
        return;
      }
    }

    (next as Record<string, unknown>)[key] = candidateValue;
    mergedFields.push(fieldName);
    applySource(fieldName);
  }

  function maybeMergeSalary(existing: string | null, incoming: string | null | undefined, evidence: string | null, requiredImprovementRatio: number): void {
    const candidateValue = clean(incoming);
    if (!candidateValue) {
      return;
    }

    if (looksLikeContactNumber(candidateValue) || looksLikeContactNumber(evidence)) {
      return;
    }

    maybeMerge("salary", existing, candidateValue, requiredImprovementRatio);
  }

  function applySource(field: string): void {
    const source = candidate.source_map?.[field as keyof typeof candidate.source_map] ?? null;
    if (source) {
      next.field_sources![field] = source;
      if (source === "author_comment") {
        next.comment_supplemented_fields!.push(field);
      }
    }
  }
}

function sourcePriority(source: string | null | undefined): number {
  switch (source) {
    case "body":
      return 5;
    case "title":
      return 4;
    case "author_comment":
      return 3;
    case "derived":
      return 2;
    case "none":
      return 1;
    default:
      return 0;
  }
}

function looksLikeContactNumber(value: string | null | undefined): boolean {
  const v = clean(value);
  if (!v) {
    return false;
  }

  if (/(?:phone|mobile|tel|whatsapp|wechat|tg|telegram|contact|联系方式|电话|手机号)/i.test(v)) {
    return true;
  }

  const digits = v.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) {
    const hasCurrency = /(?:USD|CNY|RMB|HKD|SGD|EUR|GBP|TWD|[$¥￥]|k|K|万|month|year|annual|月|年)/i.test(v);
    if (!hasCurrency) {
      return true;
    }
  }

  return false;
}

function isLikelySalaryNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 10000000;
}

function looksLikeCompanyName(value: string | null | undefined): boolean {
  const v = clean(value);
  if (!v) {
    return false;
  }

  if (v.length > 40) {
    return false;
  }

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
